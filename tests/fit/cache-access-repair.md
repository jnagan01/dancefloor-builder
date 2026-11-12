# Authenticated song-details cache access repair

Source: `7fb1600`. Target: the commit containing this report.

## Root cause and narrow repair

The authenticated enrichment handler read with the user-scoped client, while the separate security hardening intentionally revoked cache access from authenticated/anonymous roles. The returned database error was discarded as a miss. Writes already used service access but also discarded returned errors.

`src/lib/enrichCache.server.ts` now lazily obtains the existing service client for both operations. The handler dynamically imports the adapter only after the unchanged authentication middleware and input validator. No permission, migration, cron, provider budget, saved-event schema, manual path, or library change was made. Runtime cache-reader audit found only this handler.

Returned read/write failures are distinct from misses (`status.failed`), with fixed sanitized diagnostics; cache timeouts retain existing `timedOut` reporting and now emit fixed diagnostics. Error objects, database payloads and song queries are never logged by the adapter/failure handlers. Partial rows returned alongside a read failure and completed provider facts survive failures. A read that returns no data cannot recover inaccessible facts; bounded existing provider fallback still applies. No new retry or deadline budget was added.

## Reproducible isolated evidence

`tests/enrichCacheHandler.test.ts` transpiles the actual RPC and actual authentication middleware into an isolated dispatcher, executes the actual adapter and actual enrichment pipeline, and replaces only framework dispatch and external claims/database/provider/AI transports. It never accesses user data. The user-scoped fake SELECT denies access; the service fake succeeds. No user SELECT occurs.

- Warm energy 8 / BPM 122 / year 2004 returns with recorded provider provenance, zero provider calls, zero AI calls and zero writes.
- Cold exact recording lookup makes three synthetic provider calls and one cache write; a second handler call reuses the saved row without further provider/AI/write calls.
- Absent/invalid authentication and oversized input reject before cache access; 200 rows accepted, 201 rejected; both text fields retain the 300-character limit.
- Requested-key projection, stale 90-day TTL, partial facts, read failures with/without recovered rows, write failures and hung read/write deadlines are exercised.
- Existing real event-route/pipeline deadline tests continue to pass, preserving partial provenance, exact-versus-estimated version evidence and strict decade behavior.

Commands/results:

- Focused cache-handler plus deadline suites: **28 passed**.
- `bunx vitest run --maxWorkers=2`: **901 passed / 87 files**.
- Python reporting tests: **28 passed**, all mail transport mocked; no email sent.
- Automatic preview compilation: **build OK**, including server import-boundary checks.

## Limited live read-only evidence (2026-11-12)

Trusted database tooling verified SELECT/INSERT/UPDATE grants: `anon=false`, `authenticated=false`, `service_role=true`. Grants were not changed. The configured service-only adapter successfully performed a bounded read with synthetic sentinel artist/title keys; no actual song payload was printed and no writes/providers were invoked. This proves adapter connectivity/access, not live warmed-cache enrichment, real wedding generation, or real provider quality. All warm/reuse/failure assertions above are synthetic, not live tests.

## Remaining acceptance

Final-head hosted macOS native/offline validation remains required before publication. Reported successful run `43292496440` covers prior head `7fb1600`, not this repair. No desktop installation, workflow change, publication, migration, real event regeneration or production data mutation occurred.