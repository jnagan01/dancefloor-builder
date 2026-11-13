# Coordinated suggestion/metadata staging — synthetic evidence (baseline 5e46335)

All data synthetic (`tests/coordinatedExpansion.test.ts`): actual event route, actual recommend handler (real
validator, server deadline, streamed partial retention; only the model stream is synthetic), 37,722 indexed
3–5 minute files, 34 client requests, targets 90/240/120 min (5400/14400/7200 s), verified 2000s / BPM 110–130 /
dance 6–10 / avoidSlow. No production data, accounts, saved events or music were read or changed.

## Live shape reproduced
- First replies: Warm Up 15 @ 12.5 s, Transition 40 @ 29.6 s, Peak 22 @ 18.5 s (3 s start-up + per-item streaming).
- Cold lookup chunks 6143/1844/9149/2771/10396/3274/7457/3300 ms (cyclic); warm cache 300 ms.
- ~20% of suggestions unlinked strangers / live-version variants / request duplicates / credited variants.
- Linked files resolve with mixed provenance: ~80% verify eligible (live: 55 of 64); others verified decade/BPM
  failures, verified slow, or unresolved (estimates only). Library shelf mostly ineligible.

## Diagnosis (baseline)
Barrier rounds: wait for every lane (29.6 s), then up to 64 serial lookups with all AI rows first (≈44 s), then
rerank, then a second round with ~8–11 s windows whose replies get no lookup time. The metadata worker sat idle
while the 12.5 s and 18.5 s replies waited for the slowest section. Owned files with merely unverified years were
never lookup candidates.

## Measured results (fake clock)
| Run | Warm Up / Transition / Peak (s) | Suggestion calls | Lookup chunks / songs | Generate |
|---|---|---|---|---|
| Baseline 5e46335, mixed | 4050 / 10290 / 5520 (short) | 6 (3 sent at 74 s with 6.8–9 s windows) | 16 / 115 | 85.4 s |
| Repaired, mixed | 5520 / 14400 / 7320 | 6 | 19 / 146 | 79.4 s |
| Repaired, warm | 5550 / 14640 / 7320 | 3 | 47 / 354 | 30.2 s |
| Repaired, cold | 5520 / 14520 / 7230 | 6 | 20 / 154 | 108.6 s (incl. cold request phase) |
| Exhausted source (12 files/section) | 3810 / 10950 / 4320 honest gap | 6 (barren lanes end) | 50 / 390 | 76.2 s |
| Metadata outage (hung chunk) | 1590 / 4410 / 2100 honest gap | 5, none after the 20 s lookup deadline | 6 / 42 | 38.6 s |
| Transient Peak failure | 5520 / 14400 / 7320 | 7 (one retry ≥ 1 s later) | 19 / 146 | 79.4 s |
| Simultaneous favourites | 5340 / 14310 / 7230 (honest gap) | 9 (3 favourite passes in flight together) | 19 / 146 | 79.4 s |

Mixed repaired: 112 expansion lookups, all with counted files, 80 eligible; no review-only lookup while lanes could
still deliver; every request returned songs; no request under 8 songs; first three requests within 1 s.

## Remaining limits
- Serial cold metadata throughput (~8 songs / 5.5 s) caps verified additions per 90 s window; lower linked yield
  than ~70% cannot fill 314 min of expansion in mixed/cold and is reported as an honest gap.
- Pass/fail of the mixed case depends on owned files with unverified years being looked up during idle time; the
  coordination alone measured 5130 / 14160 / 6780 (short) on the same fixture.
- After coverage, lookups stop after a 20 s refinement; ranking alternatives beyond that are not checked.
- Native behaviour not verified; hosted macOS and CodeQL run on the pushed commit.
