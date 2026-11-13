# Remaining metadata/suggestion timeouts after 376d12be (synthetic + live-measured evidence)

Scope: isolated synthetic fixtures plus timing probes against public providers and the AI gateway using made-up or
public song names and an in-memory cache. No production database, saved events, library, native profile, publication
or installer actions.

## Root causes found

| Native symptom | Measured cause | Repair |
| --- | --- | --- |
| AI timeout batches at ~14.8–15 s; the same "(Clean)" tracks stay `source:none` | Estimate model `openai/gpt-6-astra` (low reasoning) took **14.2 s / 23.8 s to first delta** (236/397 reasoning tokens) for the real 8-song prompt, beyond the 14.75 s estimate window. Serial follow-up groups (one start-up per trickling miss) made it worse. | Estimate model `google/gemini-3-flash-preview` (zero-retention chat-completions, already the app's recommender): **0.5–0.8 s first delta, 1.5–2.5 s complete**, no reasoning/temperature options. At most two serial estimate groups per chunk (evidence-first group, then every remaining gap), also forced at a 6 s final reserve. Estimates still only fill gaps and stay AI-labelled. |
| `failed:fetch` with no timeout, rows keeping ReccoBeats/AI facts | (a) ReccoBeats returns **404** for a track without audio features — counted as a failed lookup. (b) A grouped MusicBrainz search for 4 songs returned **count 185 with 100 recordings dominated by two songs** — the others were marked unfinished. | 404 = definitive catalogue miss (not unfinished). Truncated songs get one paced single-song search (base title also searched for "(Clean)" edits; still only an *estimate* identity) while the shared lane is open; never during a cooldown. |
| Failures lacked a cause | No per-provider status | `status.causes` counts `rate / server / denied / http / missing / malformed / network / deadline / paused / truncated` per provider and `deadline / unavailable` for the estimate — numbers only, fenced after the phase closes. |
| Peak 39 / Warm Up 38 suggestions returned zero at ~30.3 s | Real handler prompt (≈8.7k input tokens) streams **0.69–0.74 s per item** (≈155 output tokens each); 39 items finish in 27.9–29.0 s — the deadline edge. Streaming is incremental through the gateway (first item 0.86–1.58 s), so a *zero* result means no complete item arrived; the cause (stalled start vs. slow stream) was not recorded. | Proactive sizing: requests ask for what the prior (700 ms/item) or measured pace streams inside 60% of the window (20 items at 30 s), continued fairly per section. Deadline errors now report a safe numeric stage (`no model output within …` vs `first output at …ms`). |

Model change justification: the request contract was verified against the authenticated model listing (both models
zero-retention on chat-completions); latency measured live with the production prompt shape, two runs each. Tradeoff:
the estimate model does not reason; its values remain labelled `ai`, never outrank provider/tag facts, and never
satisfy strict BPM/decade limits. `openai/gpt-6-luna` (reasoning none, 0.4–0.5 s) and `google/gemini-3.1-flash-lite`
(0.3 s) were also measured; the recommender's existing model was chosen to avoid adding a vendor/model.

## Before / after (same fixtures)

| Fixture | 376d12be | Repaired |
| --- | --- | --- |
| 8 stubborn "(Clean)" rows, real SDK stream, measured start-up | AI timeout, 0/8 facts, all `source:none` | 8/8 AI-labelled, complete, 4.1 s |
| 3 chunks × 8 rows, misses in three waves | 0/24, 3/3 AI timeouts | 24/24, 0 timeouts (6 calls) |
| Trickling misses, identical 4.1 s start-up for every model | 3 serial calls, 7/8, AI timeout | 2 calls, 8/8 |
| Actual route, 34 requests, 37,722 files, 40% linked yield, BPM 90–130, timed providers | 12/51 lookups with AI timeout, 28 unfinished songs; generate 270.6 s | 0/50, 0 unfinished; generate 128.8 s; 5580/14430/7440 s |
| One section lane, measured slow-end pace (1.58 s + 0.74 s/item) | 40 asked → 38 kept at 30.0 s (partial) | 20 at 16.5 s, then 16 at 30.0 s — first songs 13.5 s earlier; ≈5% fewer items by 30 s (extra start-ups) |

Actual route with timed real pipeline + real estimate stream + 429 rate pressure + a stalled first Peak request
(seconds vs targets 5400/14400/7200): BPM 90–130 and 110–130 both — cold 5520/14610/7290, mixed 5400/14460/7260,
warm 5640/14490/7320. Requests, strict limits, slow rejection, duplicate exclusion, ≤600 lookups, saved inputs and the
library snapshot are asserted unchanged.

Live end-to-end check (public providers + gateway, in-memory cache, 8 songs incl. the five reported titles): after the
repair every run returned AI estimates for every row lacking provider facts with ≤2 model calls and no estimate
timeout; remaining incompleteness was provider-side and labelled (`reccobeats.deadline`, `musicbrainz.server` 503
after repeated probing).

## Limitations

- Zero-output suggestion replies could not be reproduced live; the new stage text identifies the cause next time.
  Smaller requests reduce deadline-edge losses but cannot fix a stalled start; a stall still costs that request's
  window (lane-local, then halved and continued).
- AI estimates merge by the unchanged provenance ranking, so they do not replace an existing heuristic estimate.
- Live ReccoBeats searches took 1–5 s each from the sandbox; slow catalogue searches can still close the 9.75 s
  provider window honestly (`deadline`). Deadlines, concurrency (≤6), the 16 s server / 20 s client margin, the 600
  lookup budget and no negative caching are unchanged.
- Hosted Mac native / CodeQL results are required on the exact final head and are not claimed here.
