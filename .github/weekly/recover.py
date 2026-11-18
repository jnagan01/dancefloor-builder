"""Bounded recovery of unallocated hosted runners; never retry a started test."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from report import GitHub, ZONE, select_run, runner_never_started

MAX_ATTEMPTS = 3
WORKFLOW = ".github/workflows/weekly-break-tests.yml"


def eligible(run, workflow, repo, branch, now, jobs, evidence):
    if not isinstance(run, dict) or not isinstance(workflow, dict):
        return False
    return (select_run([run], now, branch) == run
            and now.astimezone(ZONE).weekday() == 1
            and workflow.get("path") == WORKFLOW
            and run.get("workflow_id") == workflow.get("id")
            and run.get("repository", {}).get("full_name", "").lower() == repo.lower()
            and run.get("path", "").split("@", 1)[0] == WORKFLOW
            and run.get("status") == "completed" and run.get("conclusion") == "failure"
            and type(run.get("run_attempt")) is int and 1 <= run["run_attempt"] < MAX_ATTEMPTS
            and evidence is None and runner_never_started(jobs))


def main():
    output = Path("test-results/weekly-recovery")
    output.mkdir(parents=True, exist_ok=True)
    diagnostic = {"status": "started", "retried": False, "max_attempts": MAX_ATTEMPTS}
    try:
        api = GitHub()
        now = datetime.now(timezone.utc)
        branch = api.request("")["default_branch"]
        workflow = api.request("/actions/workflows/weekly-break-tests.yml")
        runs = api.pages("/actions/workflows/weekly-break-tests.yml/runs?event=schedule", "workflow_runs")
        run = select_run(runs, now, branch)
        if run is None:
            diagnostic["status"] = "no-scheduled-run"
            return 0  # The 8am report still reports this gap. Never invent success.
        # Read fresh state immediately before the decision; concurrency serializes
        # this controller. No cancellation, repository dispatch, or arbitrary refs.
        run = api.request(f"/actions/runs/{run['id']}")
        jobs = api.jobs(run)
        evidence = api.evidence(run)
        diagnostic.update(run_id=run["id"], attempt=run.get("run_attempt"), commit=run.get("head_sha"))
        if not eligible(run, workflow, api.repo, branch, now, jobs, evidence):
            diagnostic["status"] = "not-retryable"
            return 0
        if os.environ.get("WEEKLY_RECOVERY_DRY_RUN", "true") != "false":
            diagnostic["status"] = "would-retry"
            return 0
        api.request(f"/actions/runs/{run['id']}/rerun-failed-jobs", {}, "POST")
        diagnostic.update(status="retry-requested", retried=True)
        return 0
    except Exception:
        diagnostic["status"] = "failed"
        return 1
    finally:
        (output / "decision.json").write_text(json.dumps(diagnostic, indent=2))
        print(f"Weekly runner recovery: status={diagnostic['status']}; retried={diagnostic['retried']}")


if __name__ == "__main__":
    raise SystemExit(main())
