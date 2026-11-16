"""Closed synthetic evidence contract; never ingest provider prose or account data."""
import json
import re

CASES = {'recovery-cold': 'lookup', 'recovery-mixed': 'lookup', 'recovery-warm': 'lookup',
         'admission': 'slow', 'constrained': 'coverage', 'partial-outage': 'lookup'}
RECOVERY = {'targets-covered', 'lookup-budget', 'generation-ceiling-ms', 'ai-timeouts',
            'heuristic-ballad-admissions', 'preserved-requests', 'partial-recovery', 'identity-provenance-and-snapshot-invariants'}
RULES = {key: RECOVERY for key in CASES if key.startswith('recovery-')}
RULES['constrained'] = {'genuine-shortage', 'honest-shortage', 'bounded-exhaustion-calls', 'bounded-exhaustion-ms', 'identity-provenance-and-snapshot-invariants'}
RULES['admission'] = {f'{s}-{r}' for s in ('warmUp', 'transition', 'peak') for r in
                      ('unsupported-admissions', 'supported-remix-and-groove', 'slow-conflict', 'optional-off')} | {
    'fresh-route-withholds', 'off-route-admits', 'explicit-request-retained', 'passive-saved-membership-and-snapshots'}
RULES['partial-outage'] = {'handler-deadline-ms', 'retained-provider-energy', 'retained-provider-year', 'retained-provider-provenance', 'unknown-withheld', 'late-response-fenced'}
PROVIDERS = {'reccobeats', 'musicbrainz', 'ai'}
CAUSES = {'rate', 'server', 'denied', 'http', 'missing', 'malformed', 'network', 'deadline', 'paused', 'truncated', 'unavailable'}


def number(value):
    return type(value) in (int, float) and 0 <= value <= 1000000


def expected_check(rule, actual, expected):
    limits = {'lookup-budget': 600, 'generation-ceiling-ms': 510000, 'bounded-exhaustion-calls': 6,
              'bounded-exhaustion-ms': 120000, 'handler-deadline-ms': 20000}
    values = {'targets-covered': 3, 'preserved-requests': 34, 'retained-provider-energy': 8, 'retained-provider-year': 2005}
    if rule in limits:
        return expected == limits[rule] and (actual < expected if rule in ('generation-ceiling-ms', 'handler-deadline-ms') else actual <= expected)
    if rule in ('partial-recovery', 'genuine-shortage'):
        return expected == 1 and actual >= 1
    wanted = values.get(rule, 0 if rule == 'ai-timeouts' or rule == 'heuristic-ballad-admissions' or rule.endswith('unsupported-admissions') or rule == 'fresh-route-withholds' else 2 if rule.endswith('supported-remix-and-groove') else 1)
    return expected == wanted and actual == wanted


def validate_case(item, identity, case):
    if not isinstance(item, dict) or item.get('schema') != 1 or item.get('id') != case or item.get('category') != CASES[case]:
        return False
    if any(str(item.get(k)) != str(identity.get(k)) for k in ('commit', 'run_id', 'run_attempt', 'seed')):
        return False
    if item.get('status') not in ('passed', 'failed'):
        return False
    checks = item.get('checks')
    if not isinstance(checks, list) or len(checks) > 32:
        return False
    names = []
    for c in checks:
        if not isinstance(c, dict) or c.get('rule') not in RULES[case] or not number(c.get('actual')) or not number(c.get('expected')) or type(c.get('passed')) is not bool:
            return False
        names.append(c['rule'])
        if c['passed'] != expected_check(c['rule'], c['actual'], c['expected']):
            return False
    if len(names) != len(set(names)) or (item['status'] == 'passed' and (set(names) != RULES[case] or not all(c['passed'] for c in checks))):
        return False
    sec = item.get('sections')
    if not isinstance(sec, list) or len(sec) > 3:
        return False
    if case not in ('admission', 'partial-outage') and item['status'] == 'passed' and len(sec) != 3:
        return False
    targets = {'warmUp': 5400, 'transition': 14400, 'peak': 7200}
    seen = set()
    for s in sec:
        if not isinstance(s, dict) or s.get('section') not in targets or s['section'] in seen or s.get('target') != targets[s['section']] or not number(s.get('seconds')):
            return False
        seen.add(s['section'])
    if case.startswith('recovery-') and item['status'] == 'passed' and any(s['seconds'] < s['target'] for s in sec):
        return False
    causes = item.get('causes')
    if not isinstance(causes, dict) or set(causes) - PROVIDERS:
        return False
    for counts in causes.values():
        if not isinstance(counts, dict) or set(counts) - CAUSES or any(type(v) is not int or not 0 <= v <= 100000 for v in counts.values()):
            return False
    return True


def collect(directory, identity):
    out = {}
    for case in CASES:
        try:
            path = directory / f'{case}.json'
            if path.stat().st_size > 65536:
                raise ValueError('oversized')
            item = json.loads(path.read_text())
            out[case] = item if validate_case(item, identity, case) else {'status': 'invalid'}
        except (OSError, ValueError, TypeError):
            out[case] = {'status': 'missing'}
    return out


def findings(evidence):
    out = []
    categories = evidence.get('categories', {})
    if not isinstance(categories, dict):
        categories = {}
    for case, category in CASES.items():
        item = categories.get(case)
        if not validate_case(item, evidence, case):
            out.append((f'category-{category}-{case}-evidence', 'incomplete', f'{case}: missing, malformed or stale synthetic category evidence'))
        elif item['status'] != 'passed':
            failed = [c for c in item['checks'] if not c['passed']]
            details = '; '.join(f"{c['rule']}: expected {c['expected']}, actual {c['actual']}" for c in failed) or 'test did not complete its assertions'
            sec = '; '.join(f"{s['section']} {s['seconds']}/{s['target']} approved seconds" for s in item['sections'])
            out.append((f'category-{category}-{case}', 'failure', f'{case}: {details}; {sec}; safe simulated cause counts {json.dumps(item["causes"], sort_keys=True)}'))
    return out


def recurrence(body, run, day, seed):
    """One occurrence per run (attempts are bounded updates); retain last 20 runs plus lifetime count."""
    match = re.search(r'<!-- weekly-history:(\{[^\n]*\}) -->', body or '')
    state = {'first': str(day), 'last': str(day), 'count': 0, 'runs': [], 'highest_run': '0'}
    if match:
        try:
            previous = json.loads(match[1])
            if (isinstance(previous, dict) and type(previous.get('count')) is int and 0 <= previous['count'] <= 1000000
                    and isinstance(previous.get('runs'), list) and len(previous['runs']) <= 20
                    and str(previous.get('highest_run', '0')).isascii() and str(previous.get('highest_run', '0')).isdigit()
                    and all(isinstance(r, dict) and str(r.get('id', '')).isascii() and str(r.get('id', '')).isdigit() and type(r.get('attempt')) is int for r in previous['runs'])
                    and all(re.fullmatch(r'\d{4}-\d{2}-\d{2}', previous.get(k, '')) for k in ('first', 'last'))):
                state = previous
        except (ValueError, TypeError):
            pass
    if not run:
        return ''  # absent runs have no fabricated occurrence ID
    rid = str(run['id'])
    old = next((r for r in state['runs'] if r['id'] == rid), None)
    if old:
        old['attempt'] = max(old['attempt'], min(int(run.get('run_attempt', 1)), 10000))
    elif int(rid) > int(state.get('highest_run', '0')):
        state['count'] += 1
        state['runs'].append({'id': rid, 'attempt': min(int(run.get('run_attempt', 1)), 10000), 'day': str(day), 'seed': str(seed), 'commit': run['head_sha']})
        state['highest_run'] = rid
    state['runs'] = state['runs'][-20:]
    state['last'] = max(state['last'], str(day))
    return (f"First seen: {state['first']}\nLast seen: {state['last']}\nOccurrences: {state['count']} distinct observed regression runs (same-run attempts update, not increment).\n"
            f'<!-- weekly-history:{json.dumps(state, separators=(",", ":"))} -->\n')