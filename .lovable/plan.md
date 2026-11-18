# Reusable track information

Implement all five approved improvements together, with isolated fixtures and no publishing or installer changes.

## Safety boundary
- Leave saved events, selections, preferences, indexes, prep notes, audio, offline workspace, dependencies, workflows and secrets untouched.
- Preserve existing exact-version/credit identity, provenance, strict limits, ranking, section duration targets, timeout recovery, provider pacing, cancellation and budgets.
- The only database change is additive cache-only storage. Existing `song_metadata_cache` rows and grants remain unchanged.

## 1. Durable public evidence
- Add a service-only evidence cache with RLS enabled, service-role grants only and bounded validated entries.
- Store parsed successful Last.fm artist/track similarity, community evidence, and on-demand MusicBrainz/Last.fm details, not raw responses or private information.
- Read/write through private adapters loaded inside authenticated validated handlers. Bound storage operations by each existing request deadline.
- Return explicit bounded cache failure counts; unavailable schema during rollout falls back without breaking generation. Never cache transient failures or malformed responses as misses.

## 2. Selective freshness
- Preserve recording-specific stable facts beyond the old blanket 90-day expiry; retain stale known facts when refreshing fails.
- Track field-level update times separately from legacy rows. Use conservative legacy timestamps without inventing newer dates.
- Proposed freshness: verified stable recording facts 365 days, advisory estimates 30 days, track popularity 7 days, community evidence/details 24 hours, similarity 6 hours. Stale successful evidence may serve as explicitly dated fallback for up to 365 days; transient refresh pressure has a bounded short retry cooldown, not a negative result cache.
- Refresh only required missing/stale fields where endpoint semantics allow. New weaker evidence never replaces stronger facts; unrelated fields retain their original dates.

## 3. Separate account-local storage
- Add bounded validated IndexedDB track-information storage, separate from every existing event/music/prep database.
- Reuse exact-version facts in generation and track-details after reload, including during slow/unavailable cloud service.
- Fence reads, writes and completion by captured account/session and generation or detail subject. Required popularity and provenance remain part of completeness.
- Handle unavailable/corrupt storage without destructive repair or false saved claims. No new desktop bridge or installer dependency.

## 4. Shared compatible work
- Share parsed provider evidence only when provider method, query identity, version/credit and requested result shape agree.
- Coalesce identical active lookups with bounded ownership and independent caller acceptance/deadlines. A caller cancellation cannot cancel another consumer or extend its deadline.
- Keep unresolved transports gated, discard late payloads, consume late rejection and evict settled/rejected work. Do not retry failed chunks or stack behind a hang.
- Last.fm details and generation reuse overlapping exact-track evidence only after exact recording validation; autocorrected or smaller results cannot silently satisfy stricter requests.

## 5. Truthful presentation
- Add a simple reuse summary to the existing generation/activity presentation: local reuse, database reuse, new external checks, missing details and refresh/storage failures.
- Add source and last-updated information to relevant details results.
- Extend only the existing count-only diagnostic allowlist compatibly. Server calls are not external-provider requests, and saves count only after confirmation.

## Validation and delivery
- Focused synthetic tests cover service recreation, cold/warm request counts, field ageing, incomplete popularity, exact identities, concurrent/rejected/hung consumers, local reload/account isolation, corrupt/read/write failures, unavailable schema, 429/503/timeouts, privacy and accurate counters.
- Exercise the actual event-route and track-details consumers plus the isolated Electron preparation UI; verify unchanged requests/selections/rankings and 5400/14400/7200-second targets for identical evidence, and bounded whole-request recovery.
- Run focused checks, then one non-overlapping full regression pass. Keep hosted Mac/production/CodeQL gates unchanged and report final-head checks as pending unless actually observed.
- Record implementation decisions and executed evidence before one final code commit. Report exact files, SHA, tests, migration status, request-count comparisons and limitations; no later documentation-only commit.

## Technical approach
- Add small shared identity/freshness/validation modules, injectable service cache adapters and an account-fenced local reuse coordinator.
- Integrate existing `lastfm.functions`, `community.functions`, `lookup.functions`, enrichment pipeline, event generation, details sheet and diagnostic presentation rather than introducing parallel generation logic.
- Inspect the existing schema first (completed: six tables; `song_metadata_cache` has RLS and no client policies). Apply any new cache schema through supported migration tooling and preserve history; do not rewrite existing cache rows.