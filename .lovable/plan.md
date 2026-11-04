# Complete expansion candidate sourcing

## Change
- Replace the event page's gap-sized catalogue preselection with a pure eligible-catalogue helper. All eligible catalogue alternatives compete in the existing shared ranking; requested tracks and selection targets stay unchanged.
- Preserve natural section, curated energy/danceability, genre and decade with their actual sources. Do not invent exact release years or transfer standard-recording familiarity to arbitrary versions.
- Protect catalogue alternatives from candidate saturation, keep bounded deterministic admission and exact owned-file promotion, and preserve all existing policy filters and saved-file restoration.

## Evidence and checks
- Add pure and actual event-page tests for more candidates than slots, evidence-based displacement, arrival permutations, ownership, filters, unknown providers, neutral/expansion-off behavior and save/reopen.
- Produce a new reproducible frozen candidate-stage report against revision `985f18cf`, clearly labelled controlled rather than a replay of the unavailable native pool. Keep previous comparison artifacts unchanged.
- Run full units, focused route tests, automatic build diagnostics and isolated native validation as applicable. Leave workflow runners/concurrency unchanged; final macOS acceptance remains required.

## Boundaries
No publishing, installer release, live database queries/writes, migrations, real feedback or access to native user data/music.

## Technical approach
Reuse catalogue eligibility and conversion from `danceFloor`, offer complete bounded catalogue rows to `createCandidatePool`, and retain `rankPool` as the only final scorer. Network budgets/deadlines do not increase. Snapshot schema and identity-safe restore remain untouched.