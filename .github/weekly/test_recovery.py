import json
import unittest
from unittest.mock import MagicMock, patch
import report
import recover
from test_report import run, evidence, now


def jobs(**overrides):
    return [{"name": "synthetic", "status": "completed", "conclusion": "cancelled",
             "steps": [], "runner_id": 0, "labels": ["macos-15"], **overrides}]


def candidate(**overrides):
    return run(conclusion="failure", repository={"full_name": "synthetic/repo"},
               workflow_id=42, path=recover.WORKFLOW, **overrides)


class Recovery(unittest.TestCase):
    def eligible(self, item=None, **changes):
        args = {"run": item or candidate(), "workflow": {"id": 42, "path": recover.WORKFLOW},
                "repo": "synthetic/repo", "branch": "main", "now": now(), "jobs": jobs(), "evidence": None}
        args.update(changes)
        return recover.eligible(**args)

    def test_retries_unallocated_runner_only(self):
        self.assertTrue(self.eligible())
        self.assertTrue(self.eligible(candidate(run_attempt=2), jobs=jobs(labels=["macos-15-intel"])))
        for key, value in [("steps", [{"name": "Set up job", "conclusion": "failure"}]),
                           ("steps", None), ("runner_id", 14), ("runner_id", None),
                           ("labels", ["self-hosted"]), ("labels", []), ("name", "release"),
                           ("status", "in_progress"), ("conclusion", "success")]:
            with self.subTest(key=key, value=value):
                self.assertFalse(self.eligible(jobs=jobs(**{key: value})))
        for value in [None, [], jobs() * 2]:
            self.assertFalse(self.eligible(jobs=value))
        self.assertFalse(self.eligible(evidence=evidence()))
        self.assertFalse(self.eligible(evidence={}))

    def test_attempt_and_trust_boundaries(self):
        for change in [{"run_attempt": 3}, {"run_attempt": 99}, {"run_attempt": "1"},
                       {"run_attempt": 0}, {"run_attempt": True}, {"status": "queued"},
                       {"conclusion": "cancelled"}, {"conclusion": "success"},
                       {"event": "workflow_dispatch"}, {"event": "pull_request"},
                       {"head_branch": "other"}, {"repository": {"full_name": "other/repo"}},
                       {"workflow_id": 43}, {"path": ".github/workflows/build-desktop.yml"},
                       {"created_at": "2026-10-27T09:00:00Z"}]:
            with self.subTest(change=change):
                self.assertFalse(self.eligible({**candidate(), **change}))
        self.assertFalse(self.eligible(now=now("2026-11-04T15:00:00+00:00")))
        self.assertFalse(self.eligible(workflow={"id": 42, "path": "other.yml"}))

    def test_real_failure_or_stale_evidence_never_becomes_runner_failure(self):
        for e in [evidence(), evidence(run_attempt="0")]:
            self.assertFalse(self.eligible(evidence=e))

    def test_controller_dry_run_and_bounded_write(self):
        for dry, wanted, writes in [("true", "would-retry", 0), ("false", "retry-requested", 1)]:
            api = MagicMock()
            api.repo = "synthetic/repo"
            api.request.side_effect = [{"default_branch": "main"}, {"id": 42, "path": recover.WORKFLOW}, candidate(), None]
            api.pages.return_value = [candidate()]
            api.jobs.return_value = jobs()
            api.evidence.return_value = None
            with patch.object(recover, "GitHub", return_value=api), patch.object(recover, "datetime") as clock, patch.object(recover, "Path") as path, patch.dict("os.environ", {"WEEKLY_RECOVERY_DRY_RUN": dry}):
                clock.now.return_value = now()
                self.assertEqual(recover.main(), 0)
                diagnostic = json.loads(path.return_value.__truediv__.return_value.write_text.call_args.args[0])
                self.assertEqual(diagnostic["status"], wanted)
                posted = [c for c in api.request.call_args_list if len(c.args) > 2]
                self.assertEqual(len(posted), writes)
                if writes:
                    self.assertEqual(posted[0].args, ("/actions/runs/12/rerun-failed-jobs", {}, "POST"))

    def test_fresh_state_prevents_retry_after_concurrent_rerun(self):
        api = MagicMock()
        api.repo = "synthetic/repo"
        api.request.side_effect = [{"default_branch": "main"}, {"id": 42, "path": recover.WORKFLOW}, {**candidate(), "status": "in_progress", "run_attempt": 2}]
        api.pages.return_value = [candidate()]
        api.jobs.return_value = jobs()
        api.evidence.return_value = None
        with patch.object(recover, "GitHub", return_value=api), patch.object(recover, "datetime") as clock, patch.object(recover, "Path"), patch.dict("os.environ", {"WEEKLY_RECOVERY_DRY_RUN": "false"}):
            clock.now.return_value = now()
            self.assertEqual(recover.main(), 0)
            self.assertFalse(any(len(c.args) > 2 for c in api.request.call_args_list))

    def test_missing_schedule_and_api_failure_remain_visible_without_mutations(self):
        for error in [False, True]:
            api = MagicMock()
            api.request.side_effect = RuntimeError("synthetic") if error else [{"default_branch": "main"}, {"id": 42, "path": recover.WORKFLOW}]
            api.pages.return_value = []
            with patch.object(recover, "GitHub", return_value=api), patch.object(recover, "Path"), patch.dict("os.environ", {"WEEKLY_RECOVERY_DRY_RUN": "false"}):
                self.assertEqual(recover.main(), 1 if error else 0)
                self.assertFalse(any(len(c.args) > 2 for c in api.request.call_args_list))


class ConsolidatedReporting(unittest.TestCase):
    def test_unallocated_runner_is_one_incomplete_alert(self):
        found = report.problems(candidate(), None, jobs())
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][:2], ("runner-unavailable", "incomplete"))
        self.assertIn("No application checks ran", found[0][2])

    def test_stale_failed_evidence_never_creates_app_regressions(self):
        data = evidence(run_attempt="0")
        data["suites"]["vitest"]["status"] = "failed"
        found = report.problems(candidate(), data)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][:2], ("evidence-missing", "incomplete"))

    def test_real_failure_is_kept_and_missing_suites_are_grouped(self):
        data = evidence()
        data["suites"]["vitest"]["status"] = "failed"
        data["suites"]["prep"]["status"] = "not_run"
        data["suites"]["offline"]["status"] = "timeout"
        found = report.problems(candidate(), data)
        self.assertEqual([p[:2] for p in found], [("suite-vitest", "failure"), ("testing-incomplete", "incomplete")])
        self.assertIn("offline", found[1][2])
        self.assertIn("prep", found[1][2])

    def test_setup_failure_does_not_invent_missing_category_defects(self):
        data = evidence(suites={s: {"status": "not_run"} for s in report.REQUIRED}, categories={})
        self.assertEqual([p[:2] for p in report.problems(candidate(), data)], [("testing-incomplete", "incomplete")])

    def test_all_categories_missing_is_one_gap(self):
        found = report.problems(run(), evidence(categories={}))
        self.assertEqual([p[:2] for p in found], [("category-evidence-missing", "incomplete")])

    def test_passed_results_do_not_mask_failed_workflow(self):
        self.assertEqual(report.problems(candidate(), evidence())[0][:2], ("run-incomplete", "incomplete"))
        self.assertEqual(report.problems(run(), evidence()), [])

    def test_timing_uses_central_dst_and_records_delay(self):
        for value, due, minutes in [("2026-03-10T13:00:00+00:00", "2026-03-10T08:00:00-05:00", 0),
                                    ("2026-11-17T14:00:00+00:00", "2026-11-17T08:00:00-06:00", 0),
                                    ("2026-11-17T22:06:00+00:00", "2026-11-17T08:00:00-06:00", 486)]:
            timing = report.report_timing(now(value))
            self.assertEqual(timing["scheduled_for"], due)
            self.assertEqual(timing["delay_minutes"], minutes)

    def test_empty_successful_api_response_is_supported(self):
        with patch.dict("os.environ", {"GITHUB_REPOSITORY": "synthetic/repo", "GITHUB_TOKEN": "synthetic"}), patch.object(report.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b""
            self.assertIsNone(report.GitHub().request("/actions/runs/12/rerun-failed-jobs", {}, "POST"))


if __name__ == "__main__":
    unittest.main()
