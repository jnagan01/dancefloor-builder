import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
import urllib.request
import report
import run_tests


def now(value="2026-11-03T14:00:00+00:00"):
    return datetime.fromisoformat(value)


def run(**overrides):
    return {"id": 12, "run_attempt": 1, "head_sha": "synthetic-sha", "event": "schedule", "head_branch": "main",
            "created_at": "2026-11-03T09:00:00Z", "status": "completed", "conclusion": "success", **overrides}


def evidence(**overrides):
    return {"schema": 1, "commit": "synthetic-sha", "run_id": "12", "run_attempt": "1",
            "suites": {s: {"status": "passed"} for s in report.REQUIRED}, **overrides}


class Decisions(unittest.TestCase):
    def test_healthy_silent(self):
        self.assertEqual(report.problems(run(), evidence()), [])
        self.assertEqual(report.delivery_decision([], False, False, False), "silent")

    def test_failed(self):
        self.assertEqual(report.problems(run(conclusion="failure"))[0][0], "run-failure")

    def test_cancelled(self):
        self.assertEqual(report.problems(run(conclusion="cancelled"))[0][1], "incomplete")

    def test_queued(self):
        self.assertIn("queued", report.problems(run(status="queued", conclusion=None))[0][2])

    def test_absent(self):
        self.assertEqual(report.problems(None)[0][0], "run-absent")

    def test_previous_week_not_reused(self):
        old = run(created_at="2026-10-27T08:00:00Z")
        self.assertIsNone(report.select_run([old], now(), "main"))

    def test_dst_exact_tuesday(self):
        for timestamp, utc_hour in [("2026-03-10", "08"), ("2026-11-03", "09")]:
            candidate = run(created_at=f"{timestamp}T{utc_hour}:00:00Z")
            instant = now(f"{timestamp}T14:00:00+00:00")
            self.assertEqual(report.select_run([candidate], instant, "main"), candidate)
            self.assertEqual(str(report.tuesday(instant)), timestamp)
        self.assertEqual(str(report.tuesday(now("2026-11-04T01:00:00+00:00"))), "2026-11-03")

    def test_manual_and_wrong_branch_excluded(self):
        self.assertIsNone(report.select_run([run(event="workflow_dispatch"), run(head_branch="other")], now(), "main"))

    def test_latest_current_run_and_rerun(self):
        fresh = run(id=13, created_at="2026-11-03T10:00:00Z")
        self.assertEqual(report.select_run([fresh, run()], now(), "main")["id"], 13)
        self.assertEqual(report.problems(run(run_attempt=2), evidence())[0][0], "evidence-missing")

    def test_rerun_dedup(self):
        findings = report.problems(None)
        key = report.delivery_key("2026-11-03", findings)
        self.assertEqual(key, report.delivery_key("2026-11-03", list(reversed(findings))))
        self.assertNotEqual(key, report.delivery_key("2026-11-10", findings))
        self.assertEqual(report.delivery_decision(findings, False, True, True), "already-sent")

    def test_missing_secret(self):
        self.assertEqual(report.delivery_decision(report.problems(None), False, False, False), "missing-secret")

    def test_dry_run_no_mutation(self):
        api = MagicMock()
        api.request.return_value = {"default_branch": "main"}
        api.pages.return_value = []
        api.evidence.return_value = None
        with patch.object(report, "GitHub", return_value=api), patch.object(report, "send_mail") as mail, patch.dict("os.environ", {"WEEKLY_DRY_RUN": "true"}), patch.object(report, "Path") as path:
            self.assertEqual(report.main(), 0)
            mail.assert_not_called()
            self.assertEqual(api.request.call_count, 1)
            self.assertEqual(api.pages.call_count, 1)
        self.assertEqual(report.delivery_decision(report.problems(None), True, False, False), "dry-run")

    def test_missing_and_skipped_evidence_not_success(self):
        self.assertTrue(report.problems(run(), None))
        incomplete = evidence()
        incomplete["suites"]["prep"]["status"] = "not_run"
        self.assertEqual(report.problems(run(), incomplete)[0][0], "suite-prep")
        self.assertFalse(run_tests.valid_vitest({"success": True, "numTotalTests": 2, "numPassedTests": 1, "numPendingTests": 1}))
        self.assertFalse(run_tests.valid_vitest({"success": True, "numTotalTests": 0}))

    def test_smtp_acceptance_required(self):
        with patch.object(report.smtplib, "SMTP") as smtp, patch.dict("os.environ", {"WEEKLY_REPORT_GMAIL_APP_PASSWORD": "test-only-not-a-credential"}):
            smtp.return_value.__enter__.return_value.send_message.return_value = {"recipient": (550, b"refused")}
            with self.assertRaises(RuntimeError):
                report.send_mail("synthetic")
            smtp.return_value.__enter__.return_value.starttls.assert_called_once()

    def test_artifact_redirect_does_not_forward_token(self):
        request = urllib.request.Request("https://api.github.com/artifact", headers={"Authorization": "Bearer synthetic-test"})
        redirected = report.SafeRedirect().redirect_request(request, None, 302, "", {}, "https://example.invalid/signed-archive")
        self.assertIsNotNone(redirected)
        self.assertIsNone(redirected.get_header("Authorization"))

    def test_real_report_rerun_deduplicates_after_acceptance(self):
        stored = []
        comments = []
        api = MagicMock()
        api.repo = "synthetic/repo"
        api.evidence.return_value = None
        def request(path, data=None, method=None):
            if path == "":
                return {"default_branch": "main"}
            if path == "/issues":
                issue = {"number": 1, "html_url": "https://github.com/synthetic/repo/issues/1", **data}
                stored.append(issue)
                return issue
            if path.endswith("/comments"):
                comments.append(data)
                return data
            stored[0].update(data)
            return stored[0]
        def pages(path, key=None):
            if "workflow" in path:
                return []
            return comments if path.endswith("/comments") else stored
        api.request.side_effect = request
        api.pages.side_effect = pages
        with patch.object(report, "GitHub", return_value=api), patch.object(report, "Path"), patch.object(report, "send_mail") as mail, patch.dict("os.environ", {"WEEKLY_DRY_RUN": "false", "WEEKLY_REPORT_GMAIL_APP_PASSWORD": "synthetic"}):
            self.assertEqual(report.main(), 0)
            self.assertEqual(report.main(), 0)
            self.assertEqual(len(stored), 1)
            mail.assert_called_once()
            self.assertEqual(len(comments), 1)

    def test_missing_secret_main_fails_without_mail_or_sent_marker(self):
        api = MagicMock()
        api.repo = "synthetic/repo"
        api.request.side_effect = [{"default_branch": "main"}, {"number": 1, "html_url": "https://github.com/synthetic/repo/issues/1"}]
        api.pages.return_value = []
        api.evidence.return_value = None
        with patch.object(report, "GitHub", return_value=api), patch.object(report, "Path"), patch.object(report, "send_mail") as mail, patch.dict("os.environ", {"WEEKLY_DRY_RUN": "false", "WEEKLY_REPORT_GMAIL_APP_PASSWORD": ""}):
            self.assertEqual(report.main(), 1)
            mail.assert_not_called()
            self.assertEqual(api.request.call_count, 2)

    def test_run_discovery_outage_is_reportable(self):
        api = MagicMock()
        api.repo = "synthetic/repo"
        api.request.side_effect = [RuntimeError("synthetic outage"), {"number": 1, "html_url": "https://github.com/synthetic/repo/issues/1"}, {}]
        api.pages.return_value = []
        api.evidence.return_value = None
        with patch.object(report, "GitHub", return_value=api), patch.object(report, "Path"), patch.object(report, "send_mail") as mail, patch.dict("os.environ", {"WEEKLY_DRY_RUN": "false", "WEEKLY_REPORT_GMAIL_APP_PASSWORD": "synthetic"}):
            self.assertEqual(report.main(), 0)
            mail.assert_called_once()


if __name__ == "__main__":
    unittest.main()