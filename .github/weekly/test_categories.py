import copy
import json
import unittest
from unittest.mock import MagicMock, patch
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import categories
import report
import run_tests
from test_report import evidence, run


class Categories(unittest.TestCase):
    def test_each_required_case_missing_malformed_stale_fails_closed(self):
        for case in categories.CASES:
            for field, value in [('schema', 0), ('commit', 'stale'), ('run_id', '13'), ('run_attempt', '2'), ('seed', '7'),
                                 ('checks', []), ('causes', {'reccobeats': {'private text': 1}}), ('sections', 'bad')]:
                data = evidence()
                data['categories'][case][field] = value
                with self.subTest(case=case, field=field):
                    self.assertTrue(report.problems(run(), data))
            data = evidence(); del data['categories'][case]
            self.assertTrue(report.problems(run(), data))
        for data in [evidence(schema=1), evidence(seed=None), evidence(seed='4294967296')]:
            self.assertEqual(report.problems(run(), data)[0][0], 'evidence-missing')

    def test_injected_causes_not_regressions_success_silent(self):
        data = evidence()
        for case in ('recovery-cold', 'recovery-mixed', 'recovery-warm'):
            data['categories'][case]['causes'] = {'reccobeats': {'rate': 10, 'server': 3, 'deadline': 2}, 'ai': {'deadline': 1}}
        self.assertEqual(report.problems(run(), data), [])
        api = MagicMock(); api.evidence.return_value = data
        api.request.return_value = {'default_branch': 'main'}
        api.pages.return_value = [run()]
        with patch.object(report, 'GitHub', return_value=api), patch.object(report, 'Path'), patch.object(report, 'send_mail') as mail, patch.object(report, 'select_run', return_value=run()), patch.dict('os.environ', {'WEEKLY_DRY_RUN': 'false', 'WEEKLY_TEST_RUN_ID': ''}):
            self.assertEqual(report.main(), 0)
            mail.assert_not_called()
            self.assertEqual(api.request.call_count, 1)
            self.assertEqual(api.pages.call_count, 1)

    def test_failure_has_stable_identity_expected_actual_seconds_causes(self):
        data = evidence(); c = data['categories']['recovery-cold']; c['status'] = 'failed'
        c['checks'] = [{'rule': 'targets-covered', 'passed': False, 'actual': 2, 'expected': 3}]
        c['sections'][0]['seconds'] = 5000
        found = categories.findings(data)
        self.assertEqual(found[0][0], 'category-lookup-recovery-cold')
        self.assertIn('expected 3, actual 2', found[0][2])
        self.assertIn('5000/5400', found[0][2])
        data['seed'] = '123'; c['seed'] = '123'
        self.assertEqual(categories.findings(data)[0][0], found[0][0])

    def test_cache_and_pacing_failures_actionable_injected_outages_silent_absent_incomplete(self):
        for case, rule, actual in [('cache-artist', 'artist-delayed-warm-external', 20), ('cache-community', 'community-confirmed-none-failures', 6),
                                   ('cache-community', 'community-hung-retained-rows', 1), ('cache-shared', 'shared-coalesced-sends', 2),
                                   ('cache-diagnostics', 'diagnostics-read-schema', 0), ('cache-diagnostics', 'diagnostics-read-deadline', 2), ('provider-pacing', 'pacing-zero-floor-ms', 0)]:
            data = evidence(); c = data['categories'][case]; c['status'] = 'failed'
            check = next(x for x in c['checks'] if x['rule'] == rule)
            check.update(actual=actual, passed=False)
            with self.subTest(case=case, rule=rule):
                found = [f for f in report.problems(run(), data) if f[1] == 'failure']
                self.assertEqual(found[0][0], f"category-{categories.CASES[case]}-{case}")
                self.assertIn(f"{rule}: expected {check['expected']}, actual {actual}", found[0][2])
                self.assertNotIn('incomplete', [f[1] for f in found])
        # A forged pass with a wrong value, or an injected outage cause, is never health/finding confusion.
        data = evidence(); c = data['categories']['provider-pacing']
        c['causes'] = {'reccobeats': {'rate': 9, 'server': 4, 'deadline': 3}}
        self.assertEqual(report.problems(run(), data), [])
        next(x for x in c['checks'] if x['rule'] == 'pacing-past-floor-ms').update(actual=0, expected=0)
        self.assertTrue(categories.findings(data)[0][0].endswith('provider-pacing-evidence'))
        for case in [k for k in categories.CASES if k.startswith(('cache-', 'provider-'))]:
            data = evidence(); del data['categories'][case]
            found = report.problems(run(), data)
            with self.subTest(absent=case):
                self.assertEqual([f[1] for f in found], ['incomplete'])
                self.assertEqual(found[0][0], 'category-evidence-missing')
            data = evidence(); data['categories'][case]['status'] = 'failed'; data['categories'][case]['checks'] = []
            with self.subTest(interrupted_empty=case):
                self.assertEqual([f[1] for f in categories.findings(data)], ['incomplete'])
                self.assertEqual([f[1] for f in report.problems(run(), data)], ['incomplete'])
            data = evidence(); item = data['categories'][case]; item['status'] = 'failed'; del item['checks'][1:]
            with self.subTest(interrupted_passing=case):
                self.assertEqual([f[1] for f in categories.findings(data)], ['incomplete'])
                self.assertNotIn('failure', [f[1] for f in report.problems(run(), data)])
            data = evidence(); item = data['categories'][case]; item['status'] = 'failed'; del item['checks'][2:]
            item['checks'][1]['actual'] = item['checks'][1]['expected'] + 1; item['checks'][1]['passed'] = False
            with self.subTest(failed_then_interrupted=case):
                found = categories.findings(data)
                self.assertEqual([f[1] for f in found], ['failure'])
                self.assertIn(item['checks'][1]['rule'], found[0][2])
            self.assertEqual(categories.findings(evidence()), [])
            data = evidence(); data['categories'][case]['checks'].pop()
            self.assertEqual(categories.findings(data)[0][1], 'incomplete')

    def test_constrained_shortage_is_not_coverage_failure(self):
        data = evidence(); data['categories']['constrained']['sections'][0]['seconds'] = 120
        self.assertEqual(report.problems(run(), data), [])
        data['categories']['recovery-cold']['sections'][0]['seconds'] = 120
        self.assertTrue(report.problems(run(), data))

    def test_collection_absent_oversized_identity_mismatch(self):
        with TemporaryDirectory() as temp:
            root = Path(temp); data = evidence()
            for case, item in data['categories'].items():
                (root / f'{case}.json').write_text(json.dumps(item))
            self.assertTrue(all(c['status'] == 'passed' for c in categories.collect(root, data).values()))
            (root / 'admission.json').write_text('x' * 65537)
            self.assertEqual(categories.collect(root, data)['admission']['status'], 'missing')
            self.assertEqual(categories.collect(root, {**data, 'run_attempt': '2'})['recovery-cold']['status'], 'invalid')

    def test_recurrence_same_run_attempt_idempotent_new_run_increments_bounded(self):
        day = date(2026, 11, 17)
        body = categories.recurrence('', run(), day, '1')
        self.assertEqual(categories.recurrence(body, run(), day, '1'), body)
        body = categories.recurrence(body, run(run_attempt=2), day, '1')
        self.assertIn('Occurrences: 1 ', body)
        for i in range(13, 45):
            body = categories.recurrence(body, run(id=i), date(2026, 11, 24), '2')
        self.assertIn('Occurrences: 33 ', body)
        self.assertIn('First seen: 2026-11-17', body)
        state = json.loads(body.split('<!-- weekly-history:')[1].split(' -->')[0])
        self.assertEqual(len(state['runs']), 20)
        again = categories.recurrence(body, run(id=12, run_attempt=3), date(2026, 11, 24), '1')
        self.assertIn('Occurrences: 33 ', again)

    def test_closed_issue_reopens_and_repeat_report_does_not_increment(self):
        stored = []
        data = evidence(); c = data['categories']['admission']; c['status'] = 'failed'; c['checks'][0].update(passed=False, actual=100)
        api = MagicMock(); api.repo = 'synthetic/repo'; api.evidence.return_value = data
        def request(path, value=None, method=None):
            if path == '': return {'default_branch': 'main'}
            if path == '/issues':
                item = {'number': len(stored) + 1, 'html_url': 'https://github.com/synthetic/repo/issues/1', **value}; stored.append(item); return item
            if path.endswith('/comments'): return {}
            item = next(s for s in stored if path.endswith('/' + str(s['number']))); item.update(value); return item
        api.request.side_effect = request
        api.pages.side_effect = lambda path, key=None: [run()] if 'workflow' in path else [] if path.endswith('/comments') else stored
        with patch.object(report, 'GitHub', return_value=api), patch.object(report, 'Path'), patch.object(report, 'select_run', return_value=run()), patch.object(report, 'send_mail'), patch.dict('os.environ', {'WEEKLY_DRY_RUN': 'false', 'WEEKLY_TEST_RUN_ID': '', 'WEEKLY_REPORT_GMAIL_APP_PASSWORD': 'synthetic'}):
            self.assertEqual(report.main(), 0)
            stored[0]['state'] = 'closed'
            self.assertEqual(report.main(), 0)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]['state'], 'open')
        self.assertIn('Occurrences: 1 ', stored[0]['body'])


if __name__ == '__main__': unittest.main()