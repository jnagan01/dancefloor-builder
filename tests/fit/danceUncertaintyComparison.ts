/** Uncertain-dance-suitability comparison. BEFORE = scorer frozen at 6564da7 (pre-change); AFTER = current scorer.
 *  Identical candidate pool, facts and similarity on both sides. Ratings are reporting-only, never scorer input.
 *  Controlled fixture — NOT a live Last.fm/provider run and not a native generation. */
import rows from "./realCacheRows.json";
import { recommend, explainTop, DEFAULT_REC_CONTROLS, type Candidate, type RecInput } from "../../src/lib/prep/recommend";
import { recommend as before, explainTop as beforeExplain } from "./archived/recommend.6564da7";
import { rowCandidate } from "../../src/lib/prep/expansionRanking";
import { songIdentity } from "../../src/lib/prep/knowledge";
import type { SimilarTrackEvidence } from "../../src/lib/prep/similarTracks";
import type { EventFit } from "../../src/lib/prep/eventFit";
import { REQUESTS, SYNTHETIC_SIMILAR, BASELINE_RATINGS, SAVED_EVENT_ROWS, AFTER_FIT } from "./fitComparison";

const label = (r: { artist: string; song: string }) => `${r.artist}|${r.song}`;
type Row = { artist: string; song: string; year?: number; genre?: string; energy?: number; danceability?: number; popularity?: number; metaProv: Record<string, string> };

/** User-supplied sanitized saved baseline (Nov 4, web 0611c4dc / desktop 1.2.49): the 14 automatic additions with exact
 *  saved spellings, feel values and per-attribute provenance. Uploaded client requests are not candidates. */
const current14: Row[] = [
  { artist: "Bill Withers", song: "Lovely Day", year: 1977, genre: "Funk / Soul", energy: 5, danceability: 6, metaProv: { year: "tags", genre: "tags", energy: "catalogue", danceability: "catalogue" } },
  { artist: "Snow Patrol", song: "Chasing Cars", year: 2006, genre: "Alternative Rock", energy: 6, danceability: 6, popularity: 8, metaProv: { year: "tags", genre: "tags", energy: "estimate", danceability: "estimate", popularity: "estimate" } },
  { artist: "Stevie Wonder", song: "Signed, Sealed, Delivered I'm Yours", year: 1970, genre: "Funk / Soul", energy: 6, danceability: 8, popularity: 4, metaProv: { year: "tags", genre: "tags", energy: "catalogue", danceability: "catalogue", popularity: "estimate" } },
  { artist: "Common", song: "Be (Intro) (Clean)", year: 2005, genre: "Hip Hop", energy: 6, danceability: 7, metaProv: { year: "tags", genre: "tags", energy: "ai", danceability: "ai" } },
  { artist: "Bon Jovi", song: "Livin' on a Prayer", year: 1986, genre: "Rock", energy: 7, danceability: 6, metaProv: { year: "tags", genre: "tags", energy: "catalogue", danceability: "catalogue" } },
  { artist: "Journey", song: "Don't Stop Believin'", year: 1981, genre: "Rock", energy: 7, danceability: 6, metaProv: { year: "tags", genre: "tags", energy: "catalogue", danceability: "catalogue" } },
  { artist: "Kiss", song: "I Was Made For Lovin' You", year: 1979, genre: "Glam Rock", energy: 9, danceability: 8, metaProv: { year: "tags", genre: "tags", energy: "ai", danceability: "ai" } },
  { artist: "The O'Jays", song: "Love Train (Clean)", year: 2018, genre: "Nu Disco / Disco", energy: 6, danceability: 8, popularity: 6, metaProv: { year: "tags", genre: "tags", energy: "estimate", danceability: "estimate", popularity: "estimate" } },
  { artist: "Bee Gees", song: "Stayin Alive (Clean) (Radio Edit)", year: 2020, genre: "Electronic,Funk / Soul,Pop", metaProv: { year: "tags", genre: "tags" } },
  { artist: "Grouplove", song: "Tongue Tied", year: 2011, genre: "Indie Rock", energy: 9, danceability: 6, metaProv: { year: "tags", genre: "tags", energy: "ai", danceability: "ai" } },
  { artist: "The Jackson 5", song: "I Want You Back", year: 2005, genre: "Nu Disco / Disco", energy: 6, danceability: 8, popularity: 8, metaProv: { year: "tags", genre: "tags", energy: "catalogue", danceability: "catalogue", popularity: "estimate" } },
  { artist: "Harry Styles", song: "As It Was", year: 2022, genre: "Pop", energy: 8, danceability: 6, popularity: 9, metaProv: { year: "tags", genre: "tags", energy: "provider", danceability: "provider", popularity: "provider" } },
  { artist: "ABBA", song: "Mamma Mia", year: 2001, genre: "Pop", energy: 8, danceability: 8, popularity: 8, metaProv: { year: "tags", genre: "tags", energy: "provider", danceability: "provider", popularity: "provider" } },
  { artist: "American Authors", song: "Best Day Of My Life (Clean)", year: 2013, genre: "Pop / Top 40", energy: 9, danceability: 7, popularity: 8, metaProv: { year: "tags", genre: "tags", energy: "ai", danceability: "ai", popularity: "estimate" } },
];
/** Current user ratings (report only): 8 Good, 4 Fair, 1 Poor, 1 Unfamiliar. */
export const CURRENT_RATINGS: Record<string, string> = {
  "Bill Withers|Lovely Day": "Good", "Snow Patrol|Chasing Cars": "Poor", "Stevie Wonder|Signed, Sealed, Delivered I'm Yours": "Good",
  "Common|Be (Intro) (Clean)": "Unfamiliar", "Bon Jovi|Livin' on a Prayer": "Good", "Journey|Don't Stop Believin'": "Good",
  "Kiss|I Was Made For Lovin' You": "Fair", "The O'Jays|Love Train (Clean)": "Good", "Bee Gees|Stayin Alive (Clean) (Radio Edit)": "Good",
  "Grouplove|Tongue Tied": "Fair", "The Jackson 5|I Want You Back": "Fair", "Harry Styles|As It Was": "Fair", "ABBA|Mamma Mia": "Good",
  "American Authors|Best Day Of My Life (Clean)": "Good",
};
/** Similar-track links as listed in the saved explanations. Saved match strengths were not exported, so a fixed
 *  0.5 is used on both sides (labelled limitation). Community tags/listeners are OMITTED: only rounded listener text
 *  was supplied, and raw provider observations are not fabricated. */
const req = (a: string, s: string) => `${a} – ${s}`;
const CURRENT_SIM_TRACKS: [string, string, string[]][] = [
  ["Bill Withers", "Lovely Day", [req("Earth, Wind & Fire", "September")]],
  ["Snow Patrol", "Chasing Cars", [req("The Killers", "Mr. Brightside")]],
  ["Journey", "Don't Stop Believin'", [req("Queen", "Don't Stop Me Now")]],
  ["Kiss", "I Was Made For Lovin' You", [req("Queen", "Don't Stop Me Now")]],
  ["Grouplove", "Tongue Tied", [req("The Killers", "Mr. Brightside"), req("Walk The Moon", "Shut Up and Dance")]],
  ["ABBA", "Mamma Mia", [req("ABBA", "Dancing Queen")]],
];
const simTracks = (list: [string, string, string[]][], match = 0.5): SimilarTrackEvidence[] =>
  list.map(([artist, song, seeds]) => ({ key: songIdentity(artist, song), artist, song, seeds, bestMatch: match }));
const CURRENT_SIM_ARTISTS = [["Stevie Wonder", "Earth, Wind & Fire"], ["Common", "OutKast"], ["The O'Jays", "Earth, Wind & Fire"], ["Bee Gees", "ABBA"], ["American Authors", "Walk the Moon"]]
  .map(([artist, similarTo]) => ({ artist, similarTo, match: 0.6 }));

const ctx = (candidates: Candidate[], fit: EventFit | undefined, extra: Partial<RecInput> = {}): RecInput => ({ candidates, requests: REQUESTS, inEvent: REQUESTS, feedback: [], dismissed: [],
  similar: SYNTHETIC_SIMILAR, preferences: { genres: [], artists: [], decades: ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"], fit }, controls: DEFAULT_REC_CONTROLS, limit: 999, ...extra });

function compare(i: RecInput, ratings: Record<string, string>, top = 14) {
  const b = before(i), a = recommend(i);
  const tally = (keys: string[]) => { const t: Record<string, number> = { Good: 0, Fair: 0, Poor: 0, Unfamiliar: 0, Unrated: 0 }; for (const k of keys) t[ratings[k] ?? "Unrated"]++; return t; };
  const list = (rs: typeof a.items, old: boolean) => rs.map((r, n) => ({ rank: n + 1, track: label(r), score: r.score, fit: r.fit ?? null, evidence: r.evidence, uncertain: r.uncertain ?? [], reasons: (old ? beforeExplain : explainTop)(r), ratingReportOnly: ratings[label(r)] ?? null }));
  const bs = b.items.slice(0, top).map(label), as = a.items.slice(0, top).map(label);
  const bl = list(b.items, true), al = list(a.items, false);
  return { before: bl, after: al, hidden: { before: b.hidden, after: a.hidden }, beforeTop: bs, afterTop: as,
    changed: { removed: bs.filter(k => !as.includes(k)), added: as.filter(k => !bs.includes(k)) },
    rankMoves: al.map(r => ({ track: r.track, before: bl.find(x => x.track === r.track)?.rank ?? null, after: r.rank, scoreBefore: bl.find(x => x.track === r.track)?.score ?? null, scoreAfter: r.score })).filter(m => m.before !== m.after || m.scoreBefore !== m.scoreAfter),
    retention: { retained: as.filter(k => bs.includes(k)).length, of: top },
    unknownTop: { noEnergyDance: a.items.slice(0, top).filter(r => r.fit?.energy === undefined && r.fit?.danceability === undefined).length, noPopularity: a.items.slice(0, top).filter(r => r.fit?.popularity === undefined).length, noCommunity: a.items.slice(0, top).length },
    ratingsReportOnly: { before: tally(bs), after: tally(as) } };
}

/** Title-blind held-out synthetic cases: renamed artists/titles, every candidate gets the SAME exact-track similarity to
 *  the same request so only fit evidence differs. Predetermined boundary cases, not derived from rated tracks. */
const R0 = req("The Killers", "Mr. Brightside");
export const heldOut: { id: string; row: Row }[] = [
  { id: "weak 6/6 estimate + est pop 8", row: { artist: "HX Alder", song: "Quiet Road", year: 2006, energy: 6, danceability: 6, popularity: 8, metaProv: { year: "tags", energy: "estimate", danceability: "estimate", popularity: "estimate" } } },
  { id: "no feel metadata", row: { artist: "HX Birch", song: "Paper Kite", year: 2006, metaProv: { year: "tags" } } },
  { id: "verified upbeat 8/8 provider", row: { artist: "HX Cedar", song: "Neon Steps", year: 2006, energy: 8, danceability: 8, metaProv: { year: "tags", energy: "provider", danceability: "provider" } } },
  { id: "verified moderate 6/6 provider", row: { artist: "HX Dogwood", song: "Grey Line", year: 2006, energy: 6, danceability: 6, metaProv: { year: "tags", energy: "provider", danceability: "provider" } } },
  { id: "lower-energy groove 4/8 estimate", row: { artist: "HX Elm", song: "Slow Burn Funk", year: 2006, energy: 4, danceability: 8, metaProv: { year: "tags", energy: "ai", danceability: "ai" } } },
  { id: "estimated upbeat 7/8 (ai)", row: { artist: "HX Fir", song: "Bright Arc", year: 2006, energy: 7, danceability: 8, metaProv: { year: "tags", energy: "ai", danceability: "ai" } } },
  { id: "half-time BPM 70, est 6/6 (BPM ignored)", row: { artist: "HX Gum", song: "Halftime", year: 2006, energy: 6, danceability: 6, metaProv: { year: "tags", energy: "estimate", danceability: "estimate" } } },
  { id: "double-time BPM 140, est 6/6 (BPM ignored)", row: { artist: "HX Hazel", song: "Doubletime", year: 2006, energy: 6, danceability: 6, metaProv: { year: "tags", energy: "estimate", danceability: "estimate" } } },
  { id: "low-both estimate 3/3 (existing slow-risk cap)", row: { artist: "HX Ivy", song: "Candle", year: 2006, energy: 3, danceability: 3, metaProv: { year: "tags", energy: "estimate", danceability: "estimate" } } },
  { id: "remix: own upbeat feel 8/8 est (no inheritance)", row: { artist: "HX Alder", song: "Quiet Road (Club Remix)", year: 2006, energy: 8, danceability: 8, metaProv: { year: "tags", energy: "estimate", danceability: "estimate" } } },
  { id: "remix: no own feel (stays uncertain)", row: { artist: "HX Cedar", song: "Neon Steps (Acoustic)", year: 2006, metaProv: { year: "tags" } } },
];
const BPM: Record<string, number> = { "HX Gum|Halftime": 70, "HX Hazel|Doubletime": 140 };
export function heldOutCandidates(): Candidate[] {
  return heldOut.map((h, n) => ({ ref: n, ...rowCandidate({ ...h.row, ...(BPM[label(h.row)] ? { bpm: BPM[label(h.row)] } : {}) } as never, "ai") }));
}
const heldOutSim = simTracks(heldOut.map(h => [h.row.artist, h.row.song, [R0]] as [string, string, string[]]), 1);
/** Conflicting community tags (slow + party) on a weak 6/6 estimate, and dance tags on unknown feel. Synthetic,
 *  already-parsed evidence (parser is covered by communityEvidence tests). */
const communityCases = (): Candidate[] => [
  { ref: 100, artist: "HX Juniper", song: "Crossfade", origin: "ai", facts: {}, fit: { energy: 6, energySource: "estimate", danceability: 6, danceabilitySource: "estimate", community: { listeners: 500_000, slowTags: ["slow"], upbeatTags: ["party"] } as never } },
  { ref: 101, artist: "HX Kapok", song: "Stomp", origin: "ai", facts: {}, fit: { community: { listeners: 500_000, slowTags: [], upbeatTags: ["dance"] } as never } },
  { ref: 102, artist: "HX Larch", song: "Ballad Of Rain", origin: "ai", facts: {}, fit: { energy: 6, energySource: "estimate", danceability: 6, danceabilitySource: "estimate", community: { listeners: 500_000, slowTags: ["ballad"], upbeatTags: [] } as never } },
];
const communitySim = simTracks([["HX Juniper", "Crossfade", [R0]], ["HX Kapok", "Stomp", [R0]], ["HX Larch", "Ballad Of Rain", [R0]]], 1);

export function danceData() {
  const archived = rows.map(r => ({ ...r, ...(SAVED_EVENT_ROWS[label(r)] ?? {}) })).map(r => rowCandidate(r as never, "library"));
  const cur = current14.map((r, n) => ({ ref: n, ...rowCandidate(r as never, "library") }));
  const curCtx = (fit: EventFit | undefined) => ctx(cur, fit, { similar: CURRENT_SIM_ARTISTS, similarTracks: simTracks(CURRENT_SIM_TRACKS) });
  const ho = (fit: EventFit | undefined) => ctx(heldOutCandidates(), fit, { similar: [], similarTracks: heldOutSim });
  const cm = (fit: EventFit | undefined) => ctx(communityCases(), fit, { similar: [], similarTracks: communitySim });
  const same = (i: RecInput) => JSON.stringify(recommend(i)) === JSON.stringify(before(i));
  const modes: [string, EventFit | undefined][] = [["neutral (no fit)", undefined], ["familiar only (no avoidSlow)", { familiarity: "familiar" }], ["discovery only", { familiarity: "discovery" }]];
  return {
    beforeSource: "6564da7 (scorer frozen before this change; tests/fit/archived/recommend.6564da7.ts + eventFit.6564da7.ts)",
    policy: "When avoidSlow is active and a candidate lacks adequate positive upbeat support (supported energy/danceability shape, danceability ≥ 7 groove, or exact-track dance/party community tags), all similarity points together are bounded to 2. No extra penalty, never excludes, not a slow verdict; existing slow-risk caps (1) are kept, never stacked.",
    limitations: [
      "Controlled same-pool scoring fixture; not a live Last.fm/provider test and not a native generation. Full original candidate pools were never captured.",
      "Current-14 fixture: community tags/listeners omitted (only rounded listener text was supplied; raw observations are not fabricated). Similar-track match strengths were not exported; a fixed 0.5 (track) / 0.6 (artist) is used on both sides.",
      "Pools contain only the saved additions, so a track cannot be removed from a top-14 of 14 candidates; rank and score changes are reported instead. No candidates were manufactured.",
      "Ratings are reporting-only and never scorer input. Poor is not treated as slow; the cap describes uncertain dance suitability only.",
    ],
    unchangedWithoutAvoidSlow: Object.fromEntries(modes.map(([m, f]) => [m, { archived31: same(ctx(archived, f)), current14: same(curCtx(f)), heldOut: same(ho(f)), community: same(cm(f)) }])),
    archived31: compare(ctx(archived, AFTER_FIT), BASELINE_RATINGS),
    current14: compare(curCtx(AFTER_FIT), CURRENT_RATINGS),
    current14AvoidSlowOnly: compare(curCtx({ avoidSlow: true }), CURRENT_RATINGS),
    heldOut: { cases: heldOut.map(h => ({ id: h.id, track: label(h.row) })), familiarAvoidSlow: compare(ho(AFTER_FIT), {}, 11), avoidSlowOnly: compare(ho({ avoidSlow: true }), {}, 11) },
    communityCases: compare(cm({ avoidSlow: true }), {}, 3),
    originalRequests: { requestsAreNeverCandidates: true, inEvent: REQUESTS.map(label) },
  };
}

export function danceMarkdown() {
  const d = danceData();
  const sec = (name: string, v: ReturnType<typeof compare>) => [`## ${name}`, "",
    `Top-${v.retention.of} ratings (report only): BEFORE ${JSON.stringify(v.ratingsReportOnly.before)} → AFTER ${JSON.stringify(v.ratingsReportOnly.after)}. Retained ${v.retention.retained}/${v.retention.of}.`,
    `Removed: ${v.changed.removed.join("; ") || "none"}. Added: ${v.changed.added.join("; ") || "none"}.`, "",
    "| Track | Before rank/score | After rank/score | Rating only | After reasons | After uncertainty |", "|---|---|---|---|---|---|",
    ...v.after.map(r => { const b = v.before.find(x => x.track === r.track); return `| ${r.track.replaceAll("|", " – ")} | ${b?.rank ?? "excluded"}/${b?.score ?? "—"} | ${r.rank}/${r.score} | ${r.ratingReportOnly ?? "—"} | ${r.reasons.replaceAll("|", "/")} | ${r.uncertain.join("; ").replaceAll("|", "/")} |`; }), ""].join("\n");
  return [`# Uncertain dance suitability — same-pool comparison`, "", `BEFORE: ${d.beforeSource}.`, "", `Policy: ${d.policy}`, "",
    "## Limitations", "", ...d.limitations.map(l => `- ${l}`), "",
    `Unchanged without avoidSlow: ${JSON.stringify(d.unchangedWithoutAvoidSlow)}`, "",
    sec("Archived 31-row baseline (familiar + avoidSlow)", d.archived31),
    sec("Current 14 additions (familiar + avoidSlow)", d.current14),
    sec("Current 14 additions (avoidSlow only)", d.current14AvoidSlowOnly),
    sec("Held-out title-blind cases (familiar + avoidSlow)", d.heldOut.familiarAvoidSlow),
    sec("Held-out title-blind cases (avoidSlow only)", d.heldOut.avoidSlowOnly),
    sec("Community conflict cases (avoidSlow)", d.communityCases),
  ].join("\n");
}
