# Provider pacing acceptance (synthetic only)

## Behavior
- ReccoBeats retains four workers but reserves starts together at least 50ms apart; recording searches retain their independent 1000ms lane.
- Missing/invalid Retry-After on 429/5xx/network pressure backs off 1, 2, 4, 8, 16, then 32 seconds. Valid seconds/date hints override the fallback; long hints close remaining work rather than extending generation.
- Bounded pressure/remaining waits travel only in the generation's RPC context; cache reads consume elapsed wait, and warm hits bypass provider lanes. Four healthy replies reduce pressure one step. No failed recording/chunk replay.
- Actual sent-request timeouts are counted before the phase fence. A rate-parked phase is not described as a request timeout. Late facts/causes stay fenced.
- A single final metadata warning summarizes fixed categories. Activity shows numeric provider causes, final short/missing/complete target outcomes and existing sanitized copy.
- 16s server, 20s client, phase/hard ceilings and 600-candidate budget are unchanged.

## Executed checks
All transport/storage fixtures are synthetic; no live provider, account, event, library or telemetry access.

```text
bun install --frozen-lockfile
  647 installs / 794 packages checked, no changes (sandbox Bun 1.4.4).

bunx vitest run tests/providerPressure.test.ts tests/metadataPresentation.test.ts tests/enrichScheduling.test.ts tests/enrichRecovery.test.ts tests/enrichDeadline.test.ts tests/enrichCacheHandler.test.ts tests/factsCooldownRoute.test.ts tests/generationDiagnosticsRoute.test.ts tests/generationDiagnostics.test.ts tests/factsGatherTimeout.test.ts tests/factsTimeoutReport.test.ts tests/diagnosticClientArtifact.test.ts tests/nativeDiagnosticBundles.test.ts
  152/152 passed, 13 files, 12.88s.

bunx vitest run tests/providerPressure.test.ts tests/metadataPresentation.test.ts tests/factsTiming.test.ts tests/factsTimingReport.test.ts tests/durationFill.test.ts tests/durationExpansionRoute.test.ts tests/prepEvidence.test.ts tests/preparationPolicies.test.ts tests/preparationDuplicates.test.ts tests/slowRisk.test.ts tests/copyText.test.ts tests/eventRename.test.ts tests/eventRouteRecovery.test.ts tests/recoveryWriteSafety.test.ts tests/eventAutosave.test.ts
  132/132 passed, 14 matched files, 26.05s; preparationDuplicates.test.ts does not exist and matched no file.
  This run preceded the final server timeout-counter and lane-reservation snapshot changes; the 152-test group above ran afterward.

LIBS=$(printf '%s:' /nix/store/*/lib); LD_LIBRARY_PATH="$LIBS$LD_LIBRARY_PATH" ELECTRON_BIN=/tmp/native-runtime/electron/electron xvfb-run -a node tests/native/prep.mjs
  22/22 passed on Electron 43.8.7 Linux, production permission handlers, real system clipboard.
  First launch lacked system libraries; rerun used existing Nix libraries, no project dependency changes.
  Expanded activity screenshots inspected: complete, short, missing and deadline cases.

node scripts/check-diagnostic-client.mjs /tmp/setarchitect-native-prep-RQfQpg/bundle
  Passed, 2 actual synthetic native client files (not production acceptance).

git diff --check
  Passed.
```

## Throughput trade-off
The healthy 250ms-provider fixture completed all facts for 34 cold tracks in 5.6s and 600 cold tracks in 86.25s (75 chunks) within its unchanged 90s ceiling; mixed 600 was 75s, warm 600 was 0 simulated ms and zero provider calls. The minimum spacing intentionally trades some cold throughput for smoothing; this is not a claim of global/IP quota enforcement or a real installed-Mac performance measurement. Under pressure, more tracks can honestly remain unknown inside the same budgets.

## Test corrections (not weakened budgets)
The existing pressure fixture now identifies the failing first chunk rather than assuming four immediate failed requests. The concurrency fixture holds headers for 250ms so four spaced workers really overlap, retaining its original 5–6 concurrency assertion. Cache-stall fake timers stop at observed settlement; the original strict 16s assertion remains. Route compilation is warmed once outside the unchanged individual 5s limits. Old toast assertions follow the approved final cause-aware wording.

## Mac regression follow-up evidence
- Isolated pre-pacing `93da296` warm 40%-linked fixture: 5640/14490/7320 seconds, 33.5s simulated total, passed. Paced `8c0eef` fixture: 5640/14400/6780 seconds, 87s total, failed Peak's unchanged 7200 target. This was an introduced coverage regression, not dismissed as instability.
- First-time owned-candidate promotion repair in `afd009a`: warm 5520/14430/7410 seconds, 51.2s total, four Peak calls; repeated aliases still cannot renew progress. Prior complete coordinated file passed 36/36; this does not establish final-head acceptance.
- Quick-miss six-second estimates previously returned 56 facts; repaired collection restores 112 for both 200/600 cold and mixed inputs (cold 88900ms, mixed 87500ms), within the original 90s window. Warm 600 retains 600 facts, zero simulated delay. Minimum 50ms request spacing and maximum 250ms collection remain unchanged.
- New ordering regression measures collection from the first eligible acoustic gap: ordinary first gap at 100ms, batch at 350ms. An initial exact provider hit previously consumed the window early (batch at 450ms instead of 550ms); the window now begins only when an actual acoustic gap is complete. All eight gaps share one estimate; the exact hit stays provider-labelled.
- Credit fixture reproduced alone failing its original 5000ms limit. Temporary instrumentation measured library/factory 901ms, mount 1665ms, ready 2041ms, generation finished at 5816ms (generation itself 3775ms). Moving observed-route compilation and warm-up into fixture setup retains all 1800 rows, max500 wire and local credit identity assertions. Final focused execution passed in 4019ms; limit remains 5000ms.

Final executed commands (one worker, synthetic only):
```text
bunx vitest run tests/boundedSuggestions.test.ts tests/targetedExpansionLookups.test.ts tests/candidateSourcingRoute.test.ts --maxWorkers=1
  40/40 passed, 3 files, 53.51s.
bunx vitest run tests/providerPressure.test.ts tests/metadataPresentation.test.ts tests/enrichScheduling.test.ts tests/enrichRecovery.test.ts tests/enrichDeadline.test.ts tests/enrichCacheHandler.test.ts tests/factsCooldownRoute.test.ts tests/generationDiagnosticsRoute.test.ts tests/generationDiagnostics.test.ts tests/factsGatherTimeout.test.ts tests/factsTimeoutReport.test.ts tests/diagnosticClientArtifact.test.ts tests/nativeDiagnosticBundles.test.ts --maxWorkers=1
  158/158 passed, 13 files, 66.06s.
```
The combined four-file attempt exceeded the sandbox 600s wait without a final result. The subsequent coordinatedExpansion-only attempt was interrupted by the execution environment before a final summary; neither is a pass. Its observed warm 40%-yield case retained 5520/14430/7410 seconds. No long full suite was run; final full coordinated/Mac acceptance remains pending. Preview compilation reports build OK; diff whitespace check passes.

## Remaining authoritative gates
Automatic preview compilation reports build OK. Frozen hosted TypeScript no-emit, production build, `.output/public` secrecy scan, required Mac/full regressions and CodeQL are not verified for the final commit here: no GitHub credentials/results, and sandbox instructions prohibit manual project build/typecheck. Existing workflow/guards are unchanged and must pass. No deployment, publication, installer, dependency/lockfile, database, permission, offline-schema or saved-data changes.