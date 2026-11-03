/** Same complete post-timeout facts on both sides. No metadata-timing/timeout change in this comparison. */
import rows from "./realCacheRows.json";
import { recommend, explainTop, DEFAULT_REC_CONTROLS, type Candidate, type RecInput } from "../../src/lib/prep/recommend";
import { recommend as before, explainTop as beforeExplain } from "./archived/recommend.543920d";
import { rowCandidate } from "../../src/lib/prep/expansionRanking";
import { REQUESTS, SYNTHETIC_SIMILAR, BASELINE_RATINGS, SAVED_EVENT_ROWS, AFTER_FIT } from "./fitComparison";
import { matrixInput } from "./slowRiskMatrix";
/** User-reported published 4103f4a7 profile. Ratings are NEVER supplied to recommend. Missing facts remain absent. */
export const latestProfile = [
  ["The Beatles", "Let It Be", 4,4,null,"ai","Poor"],
  ["Journey", "Don't Stop Believin'",7,6,null,"catalogue","Good"],
  ["Stevie Wonder", "Signed, Sealed, Delivered I'm Yours",6,8,4,"catalogue","Good"],
  ["Bee Gees", "Stayin' Alive (Clean Radio Edit)",null,null,null,"unknown","Good"],
  ["Snow Patrol", "Chasing Cars",6,6,8,"estimate","Poor"],
  ["Bill Withers", "Lovely Day",5,6,null,"catalogue","Good"],
  ["KISS", "I Was Made For Lovin' You",9,8,null,"ai","Fair"],
  ["Kool & The Gang", "Get Down On It (Calvo Remix) (Clean)",5,9,7,"estimate","Good"],
  ["Grouplove", "Tongue Tied",9,6,null,"ai","Fair"],
  ["The Jackson 5", "I Want You Back",6,8,8,"catalogue","Fair"],
  ["Harry Styles", "As It Was",8,6,9,"provider","Fair"],
  ["ABBA", "Mamma Mia",8,8,null,"ai","Good"],
  ["American Authors", "Best Day Of My Life (Clean)",9,7,null,"ai","Good"],
  ["A Tribe Called Quest", "Can I Kick It (Intro Clean)",7,9,7,"estimate","Fair"],
] as const;
const label = (r: {artist:string;song:string}) => `${r.artist}|${r.song}`;
export const latestRows = latestProfile.map(([artist,song,energy,danceability,popularity,src]) => ({ artist,song,
  ...(energy !== null ? {energy} : {}), ...(danceability !== null ? {danceability} : {}), ...(popularity !== null ? {popularity} : {}),
  metaProv: { ...(energy !== null ? { energy:src } : {}), ...(danceability !== null ? {danceability:src} : {}), ...(popularity !== null ? {popularity:src === "provider" ? "provider" : "estimate"} : {}) },
}));
const latestRatings = Object.fromEntries(latestProfile.map(([a,s,,,,,rating]) => [`${a}|${s}`,rating]));
const archivedRows = rows.map(r => ({ ...r, ...(SAVED_EVENT_ROWS[label(r)] ?? {}) }));
const context = (candidates: Candidate[]): RecInput => ({ candidates,requests:REQUESTS,inEvent:REQUESTS,feedback:[],dismissed:[],similar:SYNTHETIC_SIMILAR,
  preferences:{genres:[],artists:[],decades:["1970s","1980s","1990s","2000s","2010s","2020s"],fit:AFTER_FIT},controls:DEFAULT_REC_CONTROLS,limit:999 });
function compare(i: RecInput, ratings: Record<string,string>) {
  const b = before(i), a = recommend(i);
  const tally = (keys: string[]) => { const t: Record<string,number> = {Good:0,Fair:0,Poor:0,Unfamiliar:0,Unrated:0}; for (const k of keys) t[ratings[k] ?? "Unrated"]++; return t; };
  const list = (rs: typeof a.items, old: boolean) => rs.map((r,n) => ({ rank:n+1,track:label(r),score:r.score,fit:r.fit??null,evidence:r.evidence,uncertain:r.uncertain??[],reasons:(old?beforeExplain:explainTop)(r),ratingReportOnly:ratings[label(r)]??null }));
  const bs=b.items.slice(0,14).map(label), as=a.items.slice(0,14).map(label);
  const ranks = new Map(b.items.map((r,n)=>[label(r),n+1]));
  return { before:list(b.items,true),after:list(a.items,false),hidden:{before:b.hidden,after:a.hidden},beforeTop14:bs,afterTop14:as,
    changed:{removed:bs.filter(k=>!as.includes(k)),added:as.filter(k=>!bs.includes(k))},
    ratingsReportOnly:{before:tally(bs),after:tally(as)},
    overlap:{originalBaseline:{before:bs.filter(k=>k in BASELINE_RATINGS).length,after:as.filter(k=>k in BASELINE_RATINGS).length},latestPublished:{before:bs.filter(k=>k in latestRatings).length,after:as.filter(k=>k in latestRatings).length,notInPool:Object.keys(latestRatings).filter(k=>!i.candidates.some(c=>label(c)===k))}},
    rankChanges:a.items.map((r,n)=>({track:label(r),before:ranks.get(label(r))??null,after:n+1})),
  };
}
export function slowRiskData() {
  const archived = archivedRows.map(r=>rowCandidate(r as never,"library"));
  const overlay = new Map(latestRows.map(r=>[label(r),r]));
  const combined = archivedRows.map(r=> overlay.get(label(r)) ?? r);
  const keys = new Set(combined.map(label)); for (const r of latestRows) if (!keys.has(label(r))) combined.push(r as never);
  const i = context(archived), neutral = {...i,preferences:{...i.preferences,fit:undefined}};
  return { beforeSource:"543920dfd2ecf9bcb8ca5c9a2be13d13926ca450",publishedProfile:"4103f4a7 (reported native 1.2.49)",
    conditions:{durationMinutes:90,buffer:1,requests:REQUESTS,fit:AFTER_FIT,ownedOnly:false,cleanRequired:false,seasonal:false,dnp:["Village People|YMCA","DJ Casper|Cha Cha Slide","Cupid|Cupid Shuffle"],similarity:"unchanged synthetic artist links; held-out matrix has explicit synthetic exact-track links"},
    limitations:["Controlled complete-evidence scoring fixture, not exact live/native replay; original full pool and real similarity were not captured.","Both sides receive identical post-timeout evidence; BEFORE is captured current 543920d scoring, not stale pre-timeout timing.","Original 31-row archived cache and saved input fixtures remain unchanged. Profile-overlay variant replaces only captured exact versions and adds seven exact-version rows absent from the archived pool.","Strict decade eligibility is unchanged; these are rank-stage comparisons, not invented confirmed-year route outputs. Unknown/estimated years may leave real generation shortfalls.","Ratings are reporting-only, never scorer inputs. Clean/remix/intro versions have exact profile ratings, no rating transfer between versions.","Chasing Cars 6/6 estimates do not identify a ballad; removing its advisory popularity boost is not slow classification. Mixed rating changes are not proof of overall improvement.","Tradeoff: genuine low-energy grooves with high danceability remain unpenalised, but uncertain popularity supplies no points under conflicting feel. A legitimate 4/4 estimate can be demoted; it remains selectable. Held-out tests confirm boundaries, not guest response."],
    noFitUnchanged:JSON.stringify(recommend(neutral))===JSON.stringify(before(neutral)),
    archived31:compare(i,BASELINE_RATINGS),
    archivedPlusLatest:compare(context(combined.map(r=>rowCandidate(r as never,"library"))),{...BASELINE_RATINGS,...latestRatings}),
    latest14Only:compare(context(latestRows.map(r=>rowCandidate(r as never,"library"))),latestRatings),
    heldOut:compare(matrixInput(),{}),
  };
}
export function slowRiskMarkdown() {
  const d=slowRiskData();
  const section=(name:string,v:typeof d.archived31)=>[`## ${name}`,"",`Top-14 ratings (report only): BEFORE ${JSON.stringify(v.ratingsReportOnly.before)} → AFTER ${JSON.stringify(v.ratingsReportOnly.after)}.`,
    `Overlap: original baseline ${v.overlap.originalBaseline.before} → ${v.overlap.originalBaseline.after}; latest exact-version profile ${v.overlap.latestPublished.before} → ${v.overlap.latestPublished.after}; absent profile rows ${v.overlap.latestPublished.notInPool.length}.`,
    `Removed from top14: ${v.changed.removed.join("; ")||"none"}. Added: ${v.changed.added.join("; ")||"none"}.`,"",
    "| Track | Before rank/score | After rank/score | Rating only | After reasons |","|---|---|---|---|---|",
    ...v.after.map(r=>{const b=v.before.find(x=>x.track===r.track);return `| ${r.track.replaceAll("|"," – ")} | ${b?.rank??"excluded"}/${b?.score??"—"} | ${r.rank}/${r.score} | ${r.ratingReportOnly??"—"} | ${r.reasons.replaceAll("|","/")} |`;}),""].join("\n");
  return [`# Active avoid-slow scoring comparison`,"",`BEFORE source: ${d.beforeSource}. Both sides have the same complete facts. No-fit unchanged: ${d.noFitUnchanged}. Full before/after ranks, evidence and hidden counts are in slow-risk.json.`,"",...d.limitations.map(l=>`- ${l}`),"",section("Original archived 31",d.archived31),section("Archived pool + latest exact-version profile",d.archivedPlusLatest),section("Latest reported 14 only (profile diagnostic, all eligible estimates retained)",d.latest14Only),section("Predetermined held-out synthetic matrix",d.heldOut)].join("\n");
}