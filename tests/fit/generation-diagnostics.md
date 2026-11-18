# Persistent preparation diagnostics validation

## Isolation and delivery
- Separate account-scoped `setarchitect-generation-activity-v1` IndexedDB history/outbox; 50 readable records per account and 30-day retention. Malformed originals are left unchanged. Event snapshots, autosave/recovery, prep knowledge and music indexes are not diagnostic storage.
- Handled metadata, suggestion and Last.fm notices are fixed-code summaries. Final summaries contain only section identifiers, target/achieved approved known-file seconds, numeric counts, sanitized version/build and a random run reference. Account/event identities, songs, paths, credentials, payloads and raw provider errors are excluded from relay and copy.
- Authenticated RPC validates at most five reports, rebuilds nested allowlisted objects and dynamically loads the server relay. Only its handler reads the two Better Stack secrets. HTTPS host validation supports official `in.logs.betterstack.com` and regional `s<number>.<region>.betterstackdata.com` ingestion hosts; arbitrary hosts, credentials, ports and paths are rejected.
- Only HTTP 202 acknowledges delivery. No response-body parsing, redirects, SDK, database changes, global console interception or session replay. Relay timeout is 5 seconds, local sender timeout 8 seconds; retries are paced from two minutes up to one hour. Queued records remain after failure or missing config; acknowledgements are owner/session/revision fenced.

## One authorized live check (2026-11-18)
- Exactly one empty informational report was sent, `kind=synthetic_connection_check`, `synthetic=true`, `level=info`, message `SYNTHETIC CONNECTION CHECK — no user data`.
- Reference: `1a3f4890-d3bd-4381-ab96-c0a2b5bfd95f`, revision 0. The actual server relay accepted HTTP 202 and returned its matching acknowledgement.
- Execution used the actual `relay.functions.ts` handler and actual `relay.server.ts` transport in the sandbox server process with stored runtime secrets. The site-auth adapter was isolated for this authorized empty connection check: no live account/session was minted, loaded or used. This proves Better Stack acceptance, not an authenticated user/Worker-published end-to-end flow. The separate handler test exercises auth rejection and validation with synthetic transport.
- No credentials, headers, request/response bodies or raw errors were printed. No second live check, production event save, library access or publication occurred.

## Checks
- Diagnostic unit/actual-route tests: terminal statuses, handled warning/timeout persistence, partial provider counters, reload interruption, offline queue recovery, partial acceptance, account switch/sign-out/late reply, record/time retention, malformed preservation, memory fallback, allowlist redaction, host validation, synthetic-marker restrictions and 202/error/hanging/missing-config transport.
- Actual handler test: unauthenticated rejection before secrets/transport, bounded batch validation, allowlist stripping and handler-only secret access.
- Synthetic browser: the existing native preparation bundle rendered history after reload; expanded section seconds and safe copy passed at 1280×1800 and 390×844 with external requests blocked and zero page errors. This is browser evidence, not native Electron acceptance.
- Native bundle compiles; local Electron launch is unavailable (`desktop/node_modules/electron/dist/electron` absent). No install attempted. Existing GitHub native push workflow remains unchanged and must validate the final SHA after synchronization.
- Preview RPC stub excludes relay implementation, both server-secret names and both stored secret values (boolean-only inspection).

## Limitations
- HTTP acceptance is not a claim that downstream Better Stack search/indexing or alerts were inspected. Joe can independently locate the random reference.
- Existing timing-sensitive full-suite cases passed alone without timeout changes after the initial two-worker run failed; a single-worker complete rerun is used for final evidence.
- Final local evidence: single-worker full suite 1092/1092, 100 files, 732.53 seconds; new actual authenticated-handler test separately passed (one further test). Focused diagnostics group 27/27. Latest automatic preview compilation reports build OK. No separate manual production build/typecheck was run because this workspace delegates those to the automatic harness; separate production/TypeScript acceptance remains unverified.
- No GitHub CLI/token is available in this sandbox; final-head hosted Mac/CodeQL outcome cannot be claimed locally.