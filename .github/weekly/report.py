"""Issue-only weekly report. GitHub API + SMTP, Python standard library only."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from email.message import EmailMessage
import hashlib
import io
import json
import os
from pathlib import Path
import smtplib
import ssl
import urllib.request
from urllib.parse import urlsplit
import zipfile
from categories import findings as category_findings, recurrence

ZONE = ZoneInfo("America/Chicago")
REQUIRED = ("categories", "reporting", "vitest", "adversarial", "native", "offline", "race", "prep")


def tuesday(now):
    local = now.astimezone(ZONE)
    return (local - timedelta(days=(local.weekday() - 1) % 7)).date()


def select_run(runs, now, branch):
    day = tuesday(now)
    eligible = []
    for run in runs:
        stamp = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")).astimezone(ZONE)
        if (run.get("event") == "schedule" and run.get("head_branch") == branch
                and stamp.date() == day and stamp.hour >= 3):
            eligible.append(run)
    return max(eligible, key=lambda r: (r["created_at"], r.get("run_attempt", 1)), default=None)


def explicit_dry_run(api, run_id, event, dry):
    if event != "workflow_dispatch" or not dry:
        raise ValueError("Explicit run ID requires manual dry-run")
    if not run_id.isascii() or not run_id.isdecimal() or not 0 < int(run_id) < 10**20:
        raise ValueError("Invalid run ID")
    workflow = api.request("/actions/workflows/weekly-break-tests.yml")
    run = api.request(f"/actions/runs/{int(run_id)}")
    if (str(run.get("id")) != str(int(run_id))
            or run.get("repository", {}).get("full_name", "").lower() != api.repo.lower()
            or run.get("workflow_id") != workflow.get("id")
            or workflow.get("path") != ".github/workflows/weekly-break-tests.yml"
            or run.get("path", "").split("@", 1)[0] != ".github/workflows/weekly-break-tests.yml"
            or run.get("status") != "completed"):
        raise ValueError("Run is not a completed weekly test run in this repository")
    return run


def runner_never_started(jobs):
    """Positive evidence of an unallocated hosted Mac, not a guess from absent logs."""
    if not isinstance(jobs, list) or len(jobs) != 1:
        return False
    job = jobs[0]
    return (isinstance(job, dict) and job.get("name") == "synthetic"
            and job.get("status") == "completed" and job.get("conclusion") in ("cancelled", "failure", "timed_out")
            and job.get("steps") == [] and job.get("runner_id") == 0
            and bool(set(job.get("labels") or []) & {"macos-15", "macos-15-intel"}))


def problems(run, evidence=None, jobs=None):
    if not isinstance(evidence, dict):
        evidence = None
    if run is None:
        return [("run-absent", "incomplete", "No scheduled test run for this Central-time Tuesday")]
    if run.get("status") != "completed":
        status = run.get("status", "unknown")
        return [("run-incomplete", "incomplete", f"Test run is {status}")]
    if not matching_evidence(run, evidence):
        if runner_never_started(jobs):
            return [("runner-unavailable", "incomplete", "GitHub could not start the hosted Mac test job. No application checks ran; this is a testing infrastructure problem, not a confirmed app defect.")]
        return [("evidence-missing", "incomplete", "Testing could not be verified: the run has no matching completed results. Missing results are not evidence of separate app defects.")]
    # Only identity-matched evidence can establish individual regressions. One
    # interrupted job must not manufacture a separate defect for every missing suite.
    found = [(f"suite-{name}", "failure", f"{name}: failed")
             for name in REQUIRED if evidence["suites"].get(name, {}).get("status") == "failed"]
    incomplete = [name for name in REQUIRED if evidence["suites"].get(name, {}).get("status") not in ("passed", "failed")]
    if incomplete:
        found.append(("testing-incomplete", "incomplete", "Testing stopped or results were incomplete for: " + ", ".join(incomplete)))
    categories = category_findings(evidence)
    found.extend(item for item in categories if item[1] == "failure")
    if any(item[1] == "incomplete" for item in categories) and "categories" not in incomplete:
        found.append(("category-evidence-missing", "incomplete", "Preparation category results were missing, malformed or stale; no separate app defects are inferred."))
    if run.get("conclusion") != "success" and not found:
        found.append(("run-incomplete", "incomplete", "Recorded checks passed, but GitHub did not finish the complete test workflow successfully."))
    return found


def report_timing(now):
    local = now.astimezone(ZONE)
    due = datetime.combine(tuesday(now), datetime.min.time(), ZONE).replace(hour=8)
    return {"scheduled_for": due.isoformat(), "generated_at": local.isoformat(),
            "delay_minutes": max(0, int((now - due).total_seconds() // 60))}


def matching_evidence(run, evidence):
    if not isinstance(evidence, dict):
        return False
    seed = evidence.get('seed')
    return (isinstance(evidence, dict) and evidence.get('schema') == 2
            and evidence.get('commit') == run.get('head_sha') and str(evidence.get('run_id')) == str(run['id'])
            and str(evidence.get('run_attempt')) == str(run.get('run_attempt', 1))
            and isinstance(seed, str) and seed.isascii() and seed.isdecimal() and len(seed) <= 10 and int(seed) <= 4294967295
            and isinstance(evidence.get('suites'), dict) and all(isinstance(v, dict) for v in evidence['suites'].values()))


def delivery_key(day, findings):
    identity = json.dumps([str(day), sorted((p[0], p[1], p[2]) for p in findings)])
    return hashlib.sha256(identity.encode()).hexdigest()[:24]


def delivery_decision(findings, dry_run, already_sent, secret_available):
    if not findings:
        return "silent"
    if dry_run:
        return "dry-run"
    if already_sent:
        return "already-sent"
    return "send" if secret_available else "missing-secret"


def safe_decision(diagnostic):
    allowed = {"silent", "dry-run", "started", "send", "already-sent", "missing-secret", "smtp-accepted", "failed"}
    status = diagnostic.get("status")
    status = status if status in allowed else "failed"
    run_id = str(diagnostic.get("run_id", ""))
    run_id = run_id if run_id.isascii() and run_id.isdecimal() and len(run_id) <= 20 else "none"
    return f"Weekly report: status={status}; runID={run_id}; findings={len(diagnostic.get('findings', []))}"


class GitHub:
    def __init__(self):
        self.repo = os.environ["GITHUB_REPOSITORY"]
        self.base = f"https://api.github.com/repos/{self.repo}"

    def request(self, path, data=None, method=None, raw=False):
        request = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(),
                                         method=method, headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                                         "Accept": "application/vnd.github+json", "Content-Type": "application/json",
                                         "X-GitHub-Api-Version": "2022-11-28"})
        with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
            content = response.read(20 * 1024 * 1024 + 1)
        if len(content) > 20 * 1024 * 1024:
            raise ValueError("API response exceeds bounded limit")
        return content if raw else json.loads(content) if content else None

    def pages(self, path, key=None):
        out = []
        for page in range(1, 101):
            data = self.request(f"{path}{'&' if '?' in path else '?'}per_page=100&page={page}")
            rows = data[key] if key else data
            out.extend(rows)
            if len(rows) < 100:
                return out
        raise RuntimeError("Pagination limit reached; refusing incomplete deduplication")

    def evidence(self, run):
        if not run or run.get("status") != "completed":
            return None
        # Run artifacts may include older rerun attempts. Require creation after this attempt started.
        artifacts = self.pages(f"/actions/runs/{run['id']}/artifacts", "artifacts")
        eligible = [a for a in artifacts if a["name"] == "weekly-synthetic-results" and not a["expired"]
                    and a["created_at"] >= run.get("run_started_at", run["created_at"])]
        if not eligible:
            return None
        artifact = max(eligible, key=lambda a: a["created_at"])
        if artifact.get("size_in_bytes", 0) > 20 * 1024 * 1024:
            raise ValueError("Diagnostic artifact exceeds safe download limit")
        data = self.request(f"/actions/artifacts/{artifact['id']}/zip", raw=True)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = [n for n in archive.namelist() if n.endswith("weekly/result.json") or n == "result.json"]
            if len(names) != 1 or archive.getinfo(names[0]).file_size > 1024 * 1024:
                raise ValueError("Missing or oversized structured result")
            return json.loads(archive.read(names[0]))

    def jobs(self, run):
        return self.pages(f"/actions/runs/{run['id']}/attempts/{run.get('run_attempt', 1)}/jobs", "jobs")


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Signed artifact downloads redirect outside GitHub; do not forward the token."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != "https":
            raise ValueError("Refusing non-TLS artifact redirect")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urlsplit(req.full_url).netloc != urlsplit(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


def send_mail(body):
    message = EmailMessage()
    message["From"] = "joe@exceptional-entertainment.com"
    message["To"] = "joe@exceptional-entertainment.com"
    message["Subject"] = "SetArchitect weekly synthetic tests: attention needed"
    message.set_content(body)
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login("joe@exceptional-entertainment.com", os.environ["WEEKLY_REPORT_GMAIL_APP_PASSWORD"])
        if smtp.send_message(message):
            raise RuntimeError("SMTP did not accept every recipient")


def main():
    output = Path("test-results/weekly-report")
    output.mkdir(parents=True, exist_ok=True)
    diagnostic = {"status": "started", "sent": False}
    def persist():
        (output / "decision.json").write_text(json.dumps(diagnostic, indent=2))
    persist()
    try:
        api = GitHub()
        now = datetime.now(timezone.utc)
        diagnostic.update(report_timing(now))
        day = tuesday(now)
        dry = os.environ.get("WEEKLY_DRY_RUN", "true") == "true"
        run_id = os.environ.get("WEEKLY_TEST_RUN_ID", "").strip()
        if run_id:
            # Fail closed outside discovery-error reporting: a rejected override must never create issues or email.
            run = explicit_dry_run(api, run_id, os.environ.get("GITHUB_EVENT_NAME"), dry)
            diagnostic["mode"] = "explicit-run-dry-run"
        else:
            try:
                branch = api.request("")["default_branch"]
                runs = api.pages("/actions/workflows/weekly-break-tests.yml/runs?event=schedule", "workflow_runs")
                run = select_run(runs, now, branch)
            except Exception:
                run = None
                findings = [("run-discovery-unavailable", "incomplete", "Could not locate this Tuesday's scheduled tests through GitHub Actions")]
        try:
            evidence = api.evidence(run)
            if "findings" not in locals():
                jobs = None
                if run and run.get("status") == "completed" and not matching_evidence(run, evidence):
                    try:
                        jobs = api.jobs(run)
                    except Exception:
                        pass  # Missing diagnostics remain one incomplete-testing finding.
                findings = problems(run, evidence, jobs)
        except Exception:
            evidence = None
            findings = [("evidence-unavailable", "incomplete", "Could not read current run evidence")]
        diagnostic.update(tuesday=str(day), commit=run.get("head_sha") if run else None,
                          seed=(evidence or {}).get("seed"), run_id=run.get("id") if run else None,
                          findings=findings)
        if not findings or dry:
            diagnostic["status"] = "silent" if not findings else "dry-run"
            persist()
            return 0
        # Scan bodies (not search indexing) to deduplicate consistently even on immediate reruns.
        issues = api.pages("/issues?state=all")
        key = delivery_key(day, findings)
        marker = f"<!-- weekly-smtp-accepted:{key} -->"
        matched = []
        sent = False
        run_url = run["html_url"] if run else f"https://github.com/{api.repo}/actions/workflows/weekly-break-tests.yml"
        for fingerprint, classification, actual in findings:
            tag = f"<!-- weekly-fingerprint:{fingerprint} -->"
            issue = next((i for i in issues if "pull_request" not in i and tag in (i.get("body") or "")), None)
            body = (f"{tag}\nClassification: {classification}\nSeverity: {'high' if classification == 'failure' else 'medium'}\n"
                    f"Expected: full unit, reporting, adversarial and four native suites pass with complete evidence.\nActual: {actual}\n"
                    + (recurrence((issue or {}).get('body', ''), run, day, (evidence or {}).get('seed')) or f"First seen: {day}\nLast seen: {day}\n")
                    + f"Repro: dispatch Weekly synthetic break tests with seed {(evidence or {}).get('seed') or day.strftime('%Y%m%d')}.\n"
                    f"Commit: {run.get('head_sha', 'unavailable') if run else 'unavailable'}\nRun/artifacts: {run_url}\n"
                    "Synthetic controlled providers only; not real user-session or external service uptime monitoring. Injected errors are expected stimuli; findings describe observed test regressions only. No automatic fix or deployment.")
            if issue:
                comments = api.pages(f"/issues/{issue['number']}/comments")
                sent = sent or any(marker in c.get("body", "") for c in comments)
                issue = api.request(f"/issues/{issue['number']}", {"body": body, "state": "open"}, "PATCH")
            else:
                issue = api.request("/issues", {"title": f"Weekly synthetic testing: {fingerprint}", "body": body})
            matched.append(issue)
        decision = delivery_decision(findings, False, sent, bool(os.environ.get("WEEKLY_REPORT_GMAIL_APP_PASSWORD")))
        diagnostic["status"] = decision
        diagnostic["issues"] = [i["html_url"] for i in matched]
        persist()
        if decision == "missing-secret":
            raise RuntimeError("Report required but GitHub Actions mail secret is unavailable")
        if decision == "send":
            kind = "confirmed test failures" if any(p[1] == "failure" for p in findings) else "testing could not complete or be verified"
            body = f"SetArchitect weekly synthetic tests: {kind} ({day}, America/Chicago).\n" + "\n".join(f"- {p[2]}" for p in findings)
            body += f"\nReport scheduled for {diagnostic['scheduled_for']}; generated at {diagnostic['generated_at']}.\n"
            if diagnostic["delay_minutes"] >= 15:
                body += "GitHub started reporting late. Scheduled Actions can be delayed; this is not an app defect.\n"
            body += "\n" + "\n".join(i["html_url"] for i in matched) + f"\nRun/artifacts: {run_url}\n"
            send_mail(body)
            diagnostic.update(status="smtp-accepted", sent=True)
            persist()
            for issue in matched:
                api.request(f"/issues/{issue['number']}/comments", {"body": f"{marker}\nSMTP accepted the weekly summary for {day}. Inbox delivery is not guaranteed."})
        return 0
    except Exception:
        if diagnostic["status"] not in ("missing-secret", "smtp-accepted"):
            diagnostic["status"] = "failed"
        diagnostic["error"] = "Report did not complete; inspect configuration/API/SMTP availability. Secret values are never logged."
        persist()
        print(diagnostic["error"])
        return 1
    finally:
        print(safe_decision(diagnostic))


if __name__ == "__main__":
    raise SystemExit(main())
