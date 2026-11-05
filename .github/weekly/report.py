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
import zipfile

ZONE = ZoneInfo("America/Chicago")
REQUIRED = ("reporting", "vitest", "adversarial", "native", "offline", "race", "prep")


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


def problems(run, evidence=None):
    if run is None:
        return [("run-absent", "incomplete", "No scheduled test run for this Central-time Tuesday")]
    if run.get("status") != "completed":
        status = run.get("status", "unknown")
        return [("run-incomplete", "incomplete", f"Test run is {status}")]
    if run.get("conclusion") != "success":
        conclusion = run.get("conclusion", "unknown")
        found = [(f"suite-{name}", "failure", f"{name}: {item.get('status', 'unknown')}")
                 for name, item in (evidence or {}).get("suites", {}).items()
                 if name in REQUIRED and item.get("status") != "passed"]
        return found or [(f"run-{conclusion}", "incomplete" if conclusion in ("cancelled", "timed_out", None) else "failure", f"Test run concluded {conclusion}")]
    if not evidence or evidence.get("schema") != 1 or evidence.get("commit") != run.get("head_sha") or str(evidence.get("run_id")) != str(run["id"]) or str(evidence.get("run_attempt")) != str(run.get("run_attempt", 1)):
        return [("evidence-missing", "incomplete", "Successful job lacks matching structured evidence")]
    return [(f"suite-{name}", "incomplete", f"{name} did not pass with complete evidence")
            for name in REQUIRED if evidence.get("suites", {}).get(name, {}).get("status") != "passed"]


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


class GitHub:
    def __init__(self):
        self.repo = os.environ["GITHUB_REPOSITORY"]
        self.base = f"https://api.github.com/repos/{self.repo}"

    def request(self, path, data=None, method=None, raw=False):
        request = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(),
                                         method=method, headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                                         "Accept": "application/vnd.github+json", "Content-Type": "application/json",
                                         "X-GitHub-Api-Version": "2022-11-28"})
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read(20 * 1024 * 1024 + 1)
        if len(content) > 20 * 1024 * 1024:
            raise ValueError("API response exceeds bounded limit")
        return content if raw else json.loads(content)

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
        day = tuesday(now)
        branch = api.request("")["default_branch"]
        runs = api.pages("/actions/workflows/weekly-break-tests.yml/runs?event=schedule", "workflow_runs")
        run = select_run(runs, now, branch)
        try:
            evidence = api.evidence(run)
            findings = problems(run, evidence)
        except Exception:
            evidence = None
            findings = [("evidence-unavailable", "incomplete", "Could not read current run evidence")]
        diagnostic.update(tuesday=str(day), commit=run.get("head_sha") if run else None,
                          seed=(evidence or {}).get("seed"), run_id=run.get("id") if run else None,
                          findings=findings)
        dry = os.environ.get("WEEKLY_DRY_RUN", "true") == "true"
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
                    f"First seen: {str(day) if issue is None else (issue.get('body') or '').split('First seen: ')[-1].splitlines()[0]}\n"
                    f"Last seen: {day}\nRepro: dispatch Weekly synthetic break tests with seed {(evidence or {}).get('seed', '20261105')}.\n"
                    f"Commit: {run.get('head_sha', 'unavailable') if run else 'unavailable'}\nRun/artifacts: {run_url}\n"
                    "Synthetic evidence only; no automatic fix or deployment.")
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
            body = f"SetArchitect synthetic tests need attention ({day}, America/Chicago).\n" + "\n".join(f"- {p[2]}" for p in findings)
            body += "\n" + "\n".join(i["html_url"] for i in matched) + f"\nRun/artifacts: {run_url}\n"
            send_mail(body)
            diagnostic.update(status="smtp-accepted", sent=True)
            persist()
            for issue in matched:
                api.request(f"/issues/{issue['number']}/comments", {"body": f"{marker}\nSMTP accepted the weekly summary for {day}. Inbox delivery is not guaranteed."})
        return 0
    except Exception:
        diagnostic["error"] = "Report did not complete; inspect configuration/API/SMTP availability. Secret values are never logged."
        persist()
        print(diagnostic["error"])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())