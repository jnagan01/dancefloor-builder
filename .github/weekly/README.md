# Weekly hosted synthetic break tests

These are two **new, independent workflows**. Existing push/PR, reusable native regression, release/signing and app automations are unchanged. Do not disable old scheduling until the new workflows have been validated; cutover is manual.

## Schedule and operation

- `weekly-break-tests.yml`: Tuesday **03:00 America/Chicago**, GitHub-hosted `macos-15`, max 45 minutes including installation. No self-hosted runner or user's Mac is used. The Mac can be off.
- `weekly-break-report.yml`: Tuesday **08:00 America/Chicago**, GitHub-hosted Ubuntu. No sleep job. Timezone schedules follow DST directly.
- Scheduled workflows must be present/enabled on the repository's **default branch**. GitHub may delay or drop scheduled jobs, especially at busy hours; 03:00 is not a guaranteed start time. At 08:00 an absent/queued/incomplete run is a reportable problem, not yesterday's success. A run delayed until another Central calendar day will not count as Tuesday's run.
- Dispatch the test workflow with a uint32 `seed` to validate/reproduce. Dispatch the report workflow with **dry_run=true** (default) to inspect the current Central Tuesday without issues, email, or sent-state writes. The report intentionally considers scheduled runs only; a manual green test is not substituted for a missing Tuesday schedule. Manual non-dry reports use the same decision/deduplication rules.
- For validation **today**, dispatch the test workflow and wait for completion. Copy that run's numeric ID from its Actions URL (`/actions/runs/ID`). Dispatch the report workflow with **dry_run=true**, **auth_only=false**, and **test_run_id=ID**. The reporter verifies the run belongs to this repository and this exact weekly test workflow and is completed, then reads its structured results without creating issues, sending mail or changing sent state. A failed completed test remains a finding, not a green result. Overrides are rejected for schedules and non-dry runs; leaving the ID blank keeps strict current-Tuesday detection.
- A clean run is silent. Failed/cancelled/timed-out/queued/missing tests, setup problems, missing artifacts and missing/skipped suites need attention. Success requires the matching commit/run/attempt result, all suites passed, nonzero tests/checks, and no skipped/todo Vitest tests.

## Synthetic-only boundaries and limits

Reuses the existing `tests/native/{run,offline,offline-ui-race,prep}.mjs` fenced temporary profiles, local stand-ins and network denial. Full Vitest runs plus seeded `tests/weeklyAdversarial.test.ts` cover CSV imports, credit/version identity, ordered exact selection restore, mocked outages/timeouts, expansion-off/client retention/honest gaps and approved-only exact exports. Existing actual event-route/Electron suites cover generation/save/reopen, defaults, offline faults and export readback. The seeded corpus uses 256 generated records with 64 collision cases; existing large-library tests use 31,250 tracks. **Never exceed 100,000 records or 5 MiB per generated import.** No production account, user music path, feedback write or real provider request is needed or permitted. No app code, snapshot schema, migration, signing secret, installer or deployment changes are part of this work.

The wrapper allows up to 12 minutes per suite and a 38-minute aggregate suite window; the whole hosted job has a 45-minute cap. It saves status before/after each suite, including not-run/running/timeout outcomes. Setup evidence is initialized before installs. GitHub runner loss or hard cancellation can prevent even `always()` uploads; the report treats unavailable evidence as incomplete and links the run logs rather than pretending an artifact exists.

Artifacts (30-day retention): `weekly-synthetic-results` (small structured result with commit/run/attempt/seed/suite outcomes), `weekly-synthetic-diagnostics` (logs, Vitest JSON, existing synthetic native screenshots/results), `weekly-report-decision`. No raw user/client/music data should ever be included. Reporting downloads only the small structured result, not screenshots/logs. Reports contain short synthetic summaries and issue/run links only.

## Secure Gmail setup — required before real reporting

1. Sign into the **joe@exceptional-entertainment.com** Google Workspace account. Enable 2-Step Verification if needed. In Google Account → Security → App passwords, create an app password named `SetArchitect weekly GitHub report`. Your Workspace administrator may need to permit app passwords; this flow cannot bypass that policy.
2. In **this GitHub repository**: Settings → Secrets and variables → Actions → **New repository secret**.
3. For new setup, use **`WEEKLY_REPORT_GMAIL_APP_PASSWORD`**. The user's already-saved **`WEEKLY_REPORT_GMAIL_APP_PASSOWRD`** is supported as a compatibility alias, so no credential re-entry is necessary. Workflow mapping is `secrets.WEEKLY_REPORT_GMAIL_APP_PASSWORD || secrets.WEEKLY_REPORT_GMAIL_APP_PASSOWRD`, always into the correctly spelled `WEEKLY_REPORT_GMAIL_APP_PASSWORD` environment variable. If both exist, the correctly spelled secret wins. Never print either value. This is a GitHub Actions secret, **not** a Lovable project secret. Do not change signing secrets.
4. Dispatch **Weekly synthetic issue report** with **auth_only=true** to check Gmail TLS/login/quit. That separate read-only-permission job does not run the reporter, send email, create issues, upload artifacts, or write delivery state; other inputs are ignored. Success confirms authentication only, not mail delivery. Missing secret/login/TLS failure fails visibly without logging exception details or credentials. No fake issue or test email is needed.
5. Validate a completed test dispatch with the explicit-run dry-run described above. Leave **auth_only=false**, **test_run_id blank**, and **dry_run=false** only when an actual current-Tuesday issue report is intended.

Only the report step or the mutually exclusive manual authentication-only step receives that secret. Test/install jobs receive no mail secret. Mail uses `smtp.gmail.com:587`, verified TLS via STARTTLS, and the same authorized address as sender and recipient. If issues exist and the secret is missing, issues/diagnostics remain and the report job **fails visibly**; it never says mail was sent. Healthy and dry runs do not require the mail secret. SMTP exceptions are not printed because credentials must never appear in diagnostics.

## Issues, delivery and retries

Issues deduplicate by a stable hidden category/suite fingerprint, with classification, severity, first/last Central Tuesday, expected/actual, seed/reproduction, commit and run/artifact links. Existing issue bodies are updated and resolved issues reopen on recurrence; issues are never auto-fixed/deployed. Reports serialize under `weekly-synthetic-report`; reruns consult issue comments before mail. Fingerprints and the week's finding-set delivery key exclude run IDs so rerunning the same problem does not create another issue or send another accepted report. Changed findings may generate an additional summary in the same week. An issue is not automatically closed after a green run.

**Delivery limitation:** sent-state comments are written only after Gmail SMTP accepts every recipient. SMTP acceptance is not proof of inbox delivery. There is no atomic transaction between SMTP and GitHub: disconnect after acceptance, or runner/API failure before the sent marker is durable, can leave uncertain delivery and cause a duplicate on retry. Check the report artifact and mailbox before retrying uncertain delivery. We do not mark failed/uncertain SMTP as sent. A marker written to any issue suppresses rerun delivery of that exact finding-set; artifact says `smtp-accepted` only after confirmed SMTP success.

Minimal permissions: tests `contents:read`; reporting `contents:read`, `actions:read`, `issues:write`. No deployment permission and no connected Gmail credentials. Artifact redirects never forward the GitHub token off-origin. GitHub Actions execution, macOS timing, repository Issues permissions and real SMTP delivery must be validated in GitHub; local tests mock these boundaries.

## Local validation

```sh
python3 -m unittest discover -s .github/weekly -p 'test_*.py' -v
bunx vitest run tests/weeklyAdversarial.test.ts
bunx vitest run
```

No credentials are needed for these checks. Do **not** run `report.py` locally against production merely to test decision logic. The hosted wrapper runs the same native scripts as the existing release gate, not installers.