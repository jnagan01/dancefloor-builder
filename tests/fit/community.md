# Community (Last.fm exact-track) evidence comparison

BEFORE scorer frozen at 110eb351f30ecd03e61f830cbdf52666f16e8746. Same pool and evidence both sides. No-fit unchanged: archived31 true, held-out true. Full data in community.json.

- Controlled scoring fixture, not live/native generation and not the original candidate pool (the full pool was never captured).
- No real Last.fm responses are included: none were fetched for this report (no live provider or user data used). Real community tags/listeners for Chasing Cars, Stayin' Alive (Clean) (Radio Edit), Ava Max or any rated track are UNKNOWN here, so archived31/latest14 carry no community evidence and BEFORE equals AFTER by construction.
- Community evidence only changes rankings when a real exact-track response contains explicit slow/ballad or dance/party top tags or ≥250k listeners; it can never exclude, never overwrite energy/danceability, and is absent when the provider is disabled, times out or answers a different track/version.
- Ratings are reporting-only and never supplied to the scorer. Ava Max (Unfamiliar) replacing Let It Be (Poor) in the published run is not counted as an improvement.
- Existing reports (comparison, timing, timeout, slow-risk) are unchanged; this report uses the exact saved spelling 'Bee Gees|Stayin' Alive (Clean) (Radio Edit)'.

## Original archived 31

Top-14 ratings (report only): BEFORE {"Good":3,"Fair":1,"Poor":0,"Unfamiliar":5,"Unrated":5} → AFTER {"Good":3,"Fair":1,"Poor":0,"Unfamiliar":5,"Unrated":5}. Retained 14/14.
Unknown in top 14 (before → after): energy+danceability 0 → 0; popularity 10 → 10; community 14 → 14.
Removed: none. Added: none.

| Track | Before rank/score | After rank/score | Rating only | After reasons |
|---|---|---|---|---|
| ABBA – Take a Chance on Me | 1/1.36 | 1/1.36 | — | Same artist as client request “ABBA – Dancing Queen” — counted half: no track-level familiarity evidence · Track popularity 7/10 (estimate, audience-wide) (advisory estimate) · 2010s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |
| Whitney Houston – How Will I Know | 2/1.36 | 2/1.36 | — | Same artist as client request “Whitney Houston – I Wanna Dance With Somebody” — counted half: no track-level familiarity evidence · Track popularity 7/10 (estimate, audience-wide) (advisory estimate) · 2010s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |
| Bill Withers – Lovely Day | 3/1.26 | 3/1.26 | Good | In the built-in crowd-standards catalogue (app curation, not chart data) · 1990s (AI estimate) is a preferred decade for this event · Energy 4/10 (AI estimate) and danceability 8/10 (AI estimate) conflict for slow avoidance: a groove is possible; not classified slow or penalised · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| Journey – Don't Stop Believin' | 4/1.26 | 4/1.26 | Good | In the built-in crowd-standards catalogue (app curation, not chart data) · 2000s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| Van Morrison – Brown Eyed Girl | 5/1.26 | 5/1.26 | — | In the built-in crowd-standards catalogue (app curation, not chart data) · 1990s (estimate) is a preferred decade for this event · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| Big Boi – All Night (Dirty) | 6/1.16 | 6/1.16 | Unfamiliar | Last.fm lists Big Boi as similar to Outkast (artist-level) — counted half: no track-level familiarity evidence · 2010s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| American Authors – Best Day Of My Life | 7/1.11 | 7/1.11 | Good | Last.fm lists American Authors as similar to Walk The Moon (artist-level) — counted half: no track-level familiarity evidence · 2010s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| The Pussycat Dolls – Buttons | 8/1.11 | 8/1.11 | — | Last.fm lists The Pussycat Dolls as similar to Usher (artist-level) — counted half: no track-level familiarity evidence · Track popularity 7/10 (estimate, audience-wide) (advisory estimate) · 2000s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |
| Grouplove – Tongue Tied | 9/1.06 | 9/1.06 | Fair | Last.fm lists Grouplove as similar to Walk The Moon (artist-level) — counted half: no track-level familiarity evidence · 2010s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Mariah Carey – A No No | 10/1.06 | 10/1.06 | Unfamiliar | Last.fm lists Mariah Carey as similar to Whitney Houston (artist-level) — counted half: no track-level familiarity evidence · 2010s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Ava Max – Freaking Me Out | 11/1.01 | 11/1.01 | Unfamiliar | Last.fm lists Ava Max as similar to Dua Lipa (artist-level) — counted half: no track-level familiarity evidence · 2010s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Zara Larsson – Don't Let Me Be Yours | 12/0.96 | 12/0.96 | Unfamiliar | Last.fm lists Zara Larsson as similar to Dua Lipa (artist-level) — counted half: no track-level familiarity evidence · 2010s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Toni Braxton – Another Sad Love Song | 13/0.86 | 13/0.86 | Unfamiliar | Last.fm lists Toni Braxton as similar to Whitney Houston (artist-level) — counted half: no track-level familiarity evidence · 1990s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| The Beatles – Here Comes the Sun | 14/0.81 | 14/0.81 | — | Last.fm lists The Beatles as similar to Queen (artist-level) — counted half: no track-level familiarity evidence · 2020s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| KISS – I Was Made For Lovin' You | 15/0.76 | 15/0.76 | Fair | Last.fm lists KISS as similar to Queen (artist-level) — counted half: no track-level familiarity evidence · 1970s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Tones and I – Dance Monkey | 16/0.75 | 16/0.75 | — | Last.fm lists Tones and I as similar to Dua Lipa (artist-level) — counted half: no track-level familiarity evidence · Track popularity 7/10 (estimate, audience-wide) (advisory estimate) · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |
| Kool & The Gang – Get Down On It | 17/0.61 | 17/0.61 | — | Track popularity 7/10 (estimate, audience-wide) (advisory estimate) · 2000s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |
| Snow Patrol – Chasing Cars | 18/0.6 | 18/0.6 | Poor | Last.fm lists Snow Patrol as similar to The Killers (artist-level) — counted half: no track-level familiarity evidence · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 8/10 is an estimate |
| Mariah Carey – Fantasy | 19/0.31 | 19/0.31 | — | Last.fm lists Mariah Carey as similar to Whitney Houston (artist-level) — counted half: no track-level familiarity evidence · 2000s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| ABBA – Honey Honey | 20/0.26 | 20/0.26 | — | Same artist as client request “ABBA – Dancing Queen” — counted half: no track-level familiarity evidence · 1970s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 6/10 is an estimate |
| Whitney Houston – I'm Every Woman | 21/0.26 | 21/0.26 | — | Same artist as client request “Whitney Houston – I Wanna Dance With Somebody” — counted half: no track-level familiarity evidence · 1990s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 6/10 is an estimate |
| T.I. – Live Your Life | 22/0.26 | 22/0.26 | — | 2000s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 1/10 is an estimate |
| The O'Jays – Love Train | 23/0.26 | 23/0.26 | — | 2000s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 6/10 is an estimate |
| Tracy Chapman – Fast Car | 24/0.26 | 24/0.26 | — | 1990s (estimate) is a preferred decade for this event · Energy 4/10 (estimate) and danceability 7/10 (estimate) conflict for slow avoidance: a groove is possible; not classified slow or penalised · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 8/10 is an estimate |
| Zach Bryan – Revival | 25/0.26 | 25/0.26 | — | 2020s (estimate) is a preferred decade for this event · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 8/10 is an estimate |
| ABBA – Mamma Mia | 26/-0.49 | 26/-0.49 | Good | Same artist as client request “ABBA – Dancing Queen” — counted half: no track-level familiarity evidence · 1990s (estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Kool & The Gang – Celebration | 27/-0.49 | 27/-0.49 | Good | 2000s (AI estimate) is a preferred decade for this event · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Mariah Carey – 8th Grade | 28/-0.7 | 28/-0.7 | — | Last.fm lists Mariah Carey as similar to Whitney Houston (artist-level) — counted half: no track-level familiarity evidence · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 3/10 is an estimate |
| Journey – Faithfully | 29/-0.75 | 29/-0.75 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 5/10 is an estimate |
| Kool & The Gang – Cherish | 30/-1.5 | 30/-1.5 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 5/10 is an estimate |
| The Beatles – Let It Be | 31/-2.94 | 31/-2.94 | Poor | Last.fm lists The Beatles as similar to Queen (artist-level) — counted half: no track-level familiarity evidence · 1970s (estimate) is a preferred decade for this event · Energy 4/10 (AI estimate) and danceability 4/10 (AI estimate) suggest low-both slow risk — ranked lower, not confirmed slow (advisory) · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |

## Latest published 14 (exact spellings, Ava Max replacing Let It Be)

Top-14 ratings (report only): BEFORE {"Good":7,"Fair":5,"Poor":1,"Unfamiliar":1,"Unrated":0} → AFTER {"Good":7,"Fair":5,"Poor":1,"Unfamiliar":1,"Unrated":0}. Retained 14/14.
Unknown in top 14 (before → after): energy+danceability 2 → 2; popularity 8 → 8; community 14 → 14.
Removed: none. Added: none.

| Track | Before rank/score | After rank/score | Rating only | After reasons |
|---|---|---|---|---|
| Harry Styles – As It Was | 1/1.5 | 1/1.5 | Fair | Track popularity 9/10 (music data provider, audience-wide) supports guest familiarity — counted half: no link to this event's requests or preferences · In the built-in crowd-standards catalogue (app curation, not chart data) — counted half: no link to this event's requests or preferences · Verified popularity supports recognition, not slow/ballad or dance suitability |
| American Authors – Best Day Of My Life (Clean) | 2/0.85 | 2/0.85 | Good | Last.fm lists American Authors as similar to Walk The Moon (artist-level) — counted half: no track-level familiarity evidence · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Grouplove – Tongue Tied | 3/0.8 | 3/0.8 | Fair | Last.fm lists Grouplove as similar to Walk The Moon (artist-level) — counted half: no track-level familiarity evidence · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| ABBA – Mamma Mia | 4/0.75 | 4/0.75 | Good | Same artist as client request “ABBA – Dancing Queen” — counted half: no track-level familiarity evidence · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Ava Max – Freaking Me Out (Clean) | 5/0.75 | 5/0.75 | Unfamiliar | Last.fm lists Ava Max as similar to Dua Lipa (artist-level) — counted half: no track-level familiarity evidence · Slow/ballad status unknown: no energy or danceability data · Guest familiarity unknown: no track popularity data |
| The Jackson 5 – I Want You Back | 6/0.68 | 6/0.68 | Fair | In the built-in crowd-standards catalogue (app curation, not chart data) — counted half: no link to this event's requests or preferences · Track popularity 8/10 (estimate, audience-wide) (advisory estimate) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| Snow Patrol – Chasing Cars | 7/0.6 | 7/0.6 | Poor | Last.fm lists Snow Patrol as similar to The Killers (artist-level) — counted half: no track-level familiarity evidence · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 8/10 is an estimate |
| Bee Gees – Stayin' Alive (Clean) (Radio Edit) | 8/0.5 | 8/0.5 | Good | In the built-in crowd-standards catalogue (app curation, not chart data) — counted half: no link to this event's requests or preferences · Slow/ballad status unknown: no energy or danceability data |
| Bill Withers – Lovely Day | 9/0.5 | 9/0.5 | Good | In the built-in crowd-standards catalogue (app curation, not chart data) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| Journey – Don't Stop Believin' | 10/0.5 | 10/0.5 | Good | In the built-in crowd-standards catalogue (app curation, not chart data) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| KISS – I Was Made For Lovin' You | 11/0.5 | 11/0.5 | Fair | Last.fm lists KISS as similar to Queen (artist-level) — counted half: no track-level familiarity evidence · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| Stevie Wonder – Signed, Sealed, Delivered I'm Yours | 12/0.5 | 12/0.5 | Good | In the built-in crowd-standards catalogue (app curation, not chart data) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| A Tribe Called Quest – Can I Kick It (Intro Clean) | 13/0.18 | 13/0.18 | Fair | Track popularity 7/10 (estimate, audience-wide) (advisory estimate) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |
| Kool & The Gang – Get Down On It (Calvo Remix) (Clean) | 14/0.18 | 14/0.18 | Good | Track popularity 7/10 (estimate, audience-wide) (advisory estimate) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 7/10 is an estimate |

## Held-out renamed synthetic provider cases

- slow-tag + estimated 6/6 + est pop 8: HO North|Lantern → {"source":"lastfm","listeners":400000,"slowTags":["ballad"],"upbeatTags":[]}
- same feel, no community data (provider disabled): HO East|Harbor → no usable evidence (unknown)
- slow tag + party tag conflict: HO South|Signal → {"source":"lastfm","listeners":300000,"slowTags":["slow"],"upbeatTags":["party"]}
- slow tag vs verified upbeat 8/7: HO West|Meridian → {"source":"lastfm","listeners":300000,"slowTags":["ballad"],"upbeatTags":[]}
- wrong version answered (live) — rejected: HO Peak|Summit → no usable evidence (unknown)
- artist-only/wrong title — rejected: HO Vale|Ridge → no usable evidence (unknown)
- generic sad/love/rock tags only: HO Glen|Ember → {"source":"lastfm","listeners":900000,"slowTags":[],"upbeatTags":[]}
- tiny listener sample with ballad tag: HO Moor|Drift → {"source":"lastfm","listeners":1200,"slowTags":[],"upbeatTags":[]}
- 3M listeners + supported upbeat 7/8 est: HO Dune|Pulse → {"source":"lastfm","listeners":3000000,"slowTags":[],"upbeatTags":["dance"]}
- 3M listeners, unknown feel: HO Fjord|Echo → {"source":"lastfm","listeners":3000000,"slowTags":[],"upbeatTags":[]}
- supported upbeat 7/8 est, no community data: HO Cove|Spark → no usable evidence (unknown)

## Held-out: familiar + avoid slow

Top-14 ratings (report only): BEFORE {"Good":0,"Fair":0,"Poor":0,"Unfamiliar":0,"Unrated":11} → AFTER {"Good":0,"Fair":0,"Poor":0,"Unfamiliar":0,"Unrated":11}. Retained 11/14.
Unknown in top 14 (before → after): energy+danceability 1 → 1; popularity 9 → 9; community 4 → 4.
Removed: none. Added: none.

| Track | Before rank/score | After rank/score | Rating only | After reasons |
|---|---|---|---|---|
| HO Dune – Pulse | 2/0 | 1/0.25 | — | Last.fm listeners 3.0M for this exact track (community count, advisory — not proof this crowd knows it) — counted half: no link to this event's requests or preferences · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO Cove – Spark | 1/0 | 2/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO East – Harbor | 3/0 | 3/0 | — | No specific evidence beyond your event rules. · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 8/10 is an estimate |
| HO Fjord – Echo | 4/0 | 4/0 | — | No specific evidence beyond your event rules. · Community listener count adds no points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unknown: no energy or danceability data · Guest familiarity unknown: no track popularity data |
| HO Glen – Ember | 5/0 | 5/0 | — | No specific evidence beyond your event rules. · Community listener count adds no points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO Moor – Drift | 6/0 | 6/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO Peak – Summit | 8/0 | 7/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO South – Signal | 9/0 | 8/0 | — | No specific evidence beyond your event rules. · Last.fm community tags "slow" conflict with tags "party": not classified slow or penalised · Community listener count adds no points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO Vale – Ridge | 10/0 | 9/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unknown: no track popularity data |
| HO West – Meridian | 11/0 | 10/0 | — | No specific evidence beyond your event rules. · Last.fm community tags "ballad" conflict with verified energy 8/10 and danceability 7/10: not classified slow or penalised · Community listener count adds no points: upbeat fit is unknown, conflicting or weakly supported · Guest familiarity unknown: no track popularity data |
| HO North – Lantern | 7/0 | 11/-2 | — | No specific evidence beyond your event rules. · Last.fm community tags "ballad" for this exact track — ranked lower, not confirmed slow (advisory) · Community listener count adds no points: upbeat fit is unknown, conflicting or weakly supported · Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported · Slow/ballad status unverified: energy/danceability are estimates or incomplete · Guest familiarity unverified: popularity 8/10 is an estimate |

## Held-out: avoid slow only

Top-14 ratings (report only): BEFORE {"Good":0,"Fair":0,"Poor":0,"Unfamiliar":0,"Unrated":11} → AFTER {"Good":0,"Fair":0,"Poor":0,"Unfamiliar":0,"Unrated":11}. Retained 11/14.
Unknown in top 14 (before → after): energy+danceability 1 → 1; popularity 9 → 9; community 4 → 4.
Removed: none. Added: none.

| Track | Before rank/score | After rank/score | Rating only | After reasons |
|---|---|---|---|---|
| HO Cove – Spark | 1/0 | 1/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO Dune – Pulse | 2/0 | 2/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO East – Harbor | 3/0 | 3/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO Fjord – Echo | 4/0 | 4/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unknown: no energy or danceability data |
| HO Glen – Ember | 5/0 | 5/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO Moor – Drift | 6/0 | 6/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO Peak – Summit | 8/0 | 7/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO South – Signal | 9/0 | 8/0 | — | No specific evidence beyond your event rules. · Last.fm community tags "slow" conflict with tags "party": not classified slow or penalised · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO Vale – Ridge | 10/0 | 9/0 | — | No specific evidence beyond your event rules. · Slow/ballad status unverified: energy/danceability are estimates or incomplete |
| HO West – Meridian | 11/0 | 10/0 | — | No specific evidence beyond your event rules. · Last.fm community tags "ballad" conflict with verified energy 8/10 and danceability 7/10: not classified slow or penalised |
| HO North – Lantern | 7/0 | 11/-2 | — | No specific evidence beyond your event rules. · Last.fm community tags "ballad" for this exact track — ranked lower, not confirmed slow (advisory) · Slow/ballad status unverified: energy/danceability are estimates or incomplete |

## Held-out: discovery (control)

Top-14 ratings (report only): BEFORE {"Good":0,"Fair":0,"Poor":0,"Unfamiliar":0,"Unrated":11} → AFTER {"Good":0,"Fair":0,"Poor":0,"Unfamiliar":0,"Unrated":11}. Retained 11/14.
Unknown in top 14 (before → after): energy+danceability 1 → 1; popularity 9 → 9; community 4 → 4.
Removed: none. Added: none.

| Track | Before rank/score | After rank/score | Rating only | After reasons |
|---|---|---|---|---|
| HO Cove – Spark | 1/0 | 1/0 | — | No specific evidence beyond your event rules. |
| HO Dune – Pulse | 2/0 | 2/0 | — | No specific evidence beyond your event rules. |
| HO East – Harbor | 3/0 | 3/0 | — | No specific evidence beyond your event rules. |
| HO Fjord – Echo | 4/0 | 4/0 | — | No specific evidence beyond your event rules. |
| HO Glen – Ember | 5/0 | 5/0 | — | No specific evidence beyond your event rules. |
| HO Moor – Drift | 6/0 | 6/0 | — | No specific evidence beyond your event rules. |
| HO North – Lantern | 7/0 | 7/0 | — | No specific evidence beyond your event rules. |
| HO Peak – Summit | 8/0 | 8/0 | — | No specific evidence beyond your event rules. |
| HO South – Signal | 9/0 | 9/0 | — | No specific evidence beyond your event rules. |
| HO Vale – Ridge | 10/0 | 10/0 | — | No specific evidence beyond your event rules. |
| HO West – Meridian | 11/0 | 11/0 | — | No specific evidence beyond your event rules. |

