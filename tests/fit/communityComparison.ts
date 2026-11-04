/** Community-evidence comparison. Identical candidate pool/evidence on both sides; ratings are reporting-only. */
import rows from "./realCacheRows.json";
import { recommend, explainTop, DEFAULT_REC_CONTROLS, type Candidate, type RecInput } from "../../src/lib/prep/recommend";
import { recommend as before, explainTop as beforeExplain } from "./archived/recommend.110eb35";
import { rowCandidate } from "../../src/lib/prep/expansionRanking";
import { parseCommunityTrackInfo } from "../../src/lib/prep/communityEvidence";
import { REQUESTS, SYNTHETIC_SIMILAR, BASELINE_RATINGS, SAVED_EVENT_ROWS, AFTER_FIT } from "./fitComparison";

/** User-reported published web 1020df6f / native 1.2.49 (Nov 4) top-14, EXACT saved artist/title spellings. Ava Max
 *  replaced The Beatles – Let It Be. Ava Max's feel/popularity were not reported, so they stay absent (unknown). */
export const latestExact = [
  ["Ava Max", "Freaking Me Out (Clean)", null,null,null,"unknown","Unfamiliar"],
  ["Journey", "Don't Stop Believin'",7,6,null,"catalogue","Good"],
  ["Stevie Wonder", "Signed, Sealed, Delivered I'm Yours",6,8,4,"catalogue","Good"],
  ["Bee Gees", "Stayin' Alive (Clean) (Radio Edit)",null,null,null,"unknown","Good"],
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
const latestRows = latestExact.map(([artist,song,energy,danceability,popularity,src]) => ({ artist,song,
  ...(energy !== null ? {energy} : {}), ...(danceability !== null ? {danceability} : {}), ...(popularity !== null ? {popularity} : {}),
  metaProv: { ...(energy !== null ? { energy:src } : {}), ...(danceability !== null ? {danceability:src} : {}), ...(popularity !== null ? {popularity:src === "provider" ? "provider" : "estimate"} : {}) },
}));
const latestRatings: Record<string,string> = Object.fromEntries(latestExact.map(([a,s,,,,,rating]) => [`${a}|${s}`,rating]));
const archivedRows = rows.map(r => ({ ...r, ...(SAVED_EVENT_ROWS[label(r)] ?? {}) }));
const context = (candidates: Candidate[], fit: RecInput["preferences"]["fit"] = AFTER_FIT): RecInput => ({ candidates,requests:REQUESTS,inEvent:REQUESTS,feedback:[],dismissed:[],similar:SYNTHETIC_SIMILAR,
  preferences:{genres:[],artists:[],decades:["1970s","1980s","1990s","2000s","2010s","2020s"],fit},controls:DEFAULT_REC_CONTROLS,limit:999 });

function compare(i: RecInput, ratings: Record<string,string>) {
  const b = before(i), a = recommend(i);
  const tally = (keys: string[]) => { const t: Record<string,number> = {Good:0,Fair:0,Poor:0,Unfamiliar:0,Unrated:0}; for (const k of keys) t[ratings[k] ?? "Unrated"]++; return t; };
  const unknown = (items: typeof a.items) => ({ noEnergyDance: items.filter(r => r.fit?.energy === undefined && r.fit?.danceability === undefined).length, noPopularity: items.filter(r => r.fit?.popularity === undefined).length, noCommunity: items.filter(r => !r.fit?.community).length });
  const list = (rs: typeof a.items, old: boolean) => rs.map((r,n) => ({ rank:n+1,track:label(r),score:r.score,fit:r.fit??null,evidence:r.evidence,uncertain:r.uncertain??[],reasons:(old?beforeExplain:explainTop)(r),ratingReportOnly:ratings[label(r)]??null }));
  const bs=b.items.slice(0,14).map(label), as=a.items.slice(0,14).map(label);
  return { before:list(b.items,true),after:list(a.items,false),hidden:{before:b.hidden,after:a.hidden},beforeTop14:bs,afterTop14:as,
    changed:{removed:bs.filter(k=>!as.includes(k)),added:as.filter(k=>!bs.includes(k))},
    retention:{top14Retained:as.filter(k=>bs.includes(k)).length},
    unknownTop14:{before:unknown(b.items.slice(0,14)),after:unknown(a.items.slice(0,14))},
    ratingsReportOnly:{before:tally(bs),after:tally(as)} };
}

/** Held-out renamed synthetic provider responses (raw track.getInfo bodies) parsed by the REAL parser, so identity,
 *  sample and tag rules apply. Predetermined boundary cases; not derived from any rated track. */
const raw = (artist: string, name: string, listeners: number, tags: string[]) => ({ track: { name, artist: { name: artist }, listeners: String(listeners), toptags: { tag: tags.map(t => ({ name: t })) } } });
export const heldOutCases = [
  { id:"slow-tag + estimated 6/6 + est pop 8", artist:"HO North", song:"Lantern", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate",popularity:8,popularitySource:"estimate"}, body:raw("HO North","Lantern",400000,["ballad","indie"]) },
  { id:"same feel, no community data (provider disabled)", artist:"HO East", song:"Harbor", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate",popularity:8,popularitySource:"estimate"}, body:null },
  { id:"slow tag + party tag conflict", artist:"HO South", song:"Signal", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate"}, body:raw("HO South","Signal",300000,["slow","party"]) },
  { id:"slow tag vs verified upbeat 8/7", artist:"HO West", song:"Meridian", fit:{energy:8,energySource:"provider",danceability:7,danceabilitySource:"provider"}, body:raw("HO West","Meridian",300000,["ballad"]) },
  { id:"wrong version answered (live) — rejected", artist:"HO Peak", song:"Summit", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate"}, body:raw("HO Peak","Summit (Live)",900000,["ballad"]) },
  { id:"artist-only/wrong title — rejected", artist:"HO Vale", song:"Ridge", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate"}, body:raw("HO Vale","Other Song",900000,["ballad"]) },
  { id:"generic sad/love/rock tags only", artist:"HO Glen", song:"Ember", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate"}, body:raw("HO Glen","Ember",900000,["sad","love","rock"]) },
  { id:"tiny listener sample with ballad tag", artist:"HO Moor", song:"Drift", fit:{energy:6,energySource:"estimate",danceability:6,danceabilitySource:"estimate"}, body:raw("HO Moor","Drift",1200,["ballad"]) },
  { id:"3M listeners + supported upbeat 7/8 est", artist:"HO Dune", song:"Pulse", fit:{energy:7,energySource:"ai",danceability:8,danceabilitySource:"ai"}, body:raw("HO Dune","Pulse",3000000,["dance"]) },
  { id:"3M listeners, unknown feel", artist:"HO Fjord", song:"Echo", fit:{}, body:raw("HO Fjord","Echo",3000000,["pop"]) },
  { id:"supported upbeat 7/8 est, no community data", artist:"HO Cove", song:"Spark", fit:{energy:7,energySource:"ai",danceability:8,danceabilitySource:"ai"}, body:null },
] as const;
export function heldOutCandidates(): Candidate[] {
  return heldOutCases.map((c, n) => { const community = c.body ? parseCommunityTrackInfo(c.body, c.artist, c.song) : undefined;
    return { ref:n, artist:c.artist, song:c.song, origin:"ai" as const, facts:{}, fit:{ ...(c.fit as object), ...(community ? { community } : {}) } }; });
}

export function communityData() {
  const archived = archivedRows.map(r=>rowCandidate(r as never,"library"));
  const latest = latestRows.map(r=>rowCandidate(r as never,"library"));
  const neutral = (i: RecInput) => ({...i,preferences:{...i.preferences,fit:undefined}});
  const ho = context(heldOutCandidates());
  return { beforeSource:"110eb351f30ecd03e61f830cbdf52666f16e8746", publishedProfile:"web 1020df6f / native 1.2.49, Nov 4 (user-reported)",
    conditions:{durationMinutes:90,buffer:1,requests:REQUESTS,fit:AFTER_FIT,ownedOnly:false,cleanRequired:false,seasonal:false,dnp:["Village People|YMCA","DJ Casper|Cha Cha Slide","Cupid|Cupid Shuffle"],similarity:"unchanged synthetic artist links (SYNTHETIC_SIMILAR)"},
    limitations:[
      "Controlled scoring fixture, not live/native generation and not the original candidate pool (the full pool was never captured).",
      "No real Last.fm responses are included: none were fetched for this report (no live provider or user data used). Real community tags/listeners for Chasing Cars, Stayin' Alive (Clean) (Radio Edit), Ava Max or any rated track are UNKNOWN here, so archived31/latest14 carry no community evidence and BEFORE equals AFTER by construction.",
      "Community evidence only changes rankings when a real exact-track response contains explicit slow/ballad or dance/party top tags or ≥250k listeners; it can never exclude, never overwrite energy/danceability, and is absent when the provider is disabled, times out or answers a different track/version.",
      "Ratings are reporting-only and never supplied to the scorer. Ava Max (Unfamiliar) replacing Let It Be (Poor) in the published run is not counted as an improvement.",
      "Existing reports (comparison, timing, timeout, slow-risk) are unchanged; this report uses the exact saved spelling 'Bee Gees|Stayin' Alive (Clean) (Radio Edit)'.",
    ],
    noFitUnchanged:{archived31:JSON.stringify(recommend(neutral(context(archived))))===JSON.stringify(before(neutral(context(archived)))),heldOut:JSON.stringify(recommend(neutral(ho)))===JSON.stringify(before(neutral(ho)))},
    archived31:compare(context(archived),BASELINE_RATINGS),
    latest14Exact:compare(context(latest),latestRatings),
    heldOut:{cases:heldOutCases.map((c,n)=>({id:c.id,track:`${c.artist}|${c.song}`,parsedCommunity:heldOutCandidates()[n].fit?.community??null})),familiarAvoidSlow:compare(ho,{}),avoidSlowOnly:compare(context(heldOutCandidates(),{avoidSlow:true}),{}),discovery:compare(context(heldOutCandidates(),{familiarity:"discovery"}),{})},
  };
}
export function communityMarkdown() {
  const d = communityData();
  const sec = (name: string, v: ReturnType<typeof compare>) => [`## ${name}`, "",
    `Top-14 ratings (report only): BEFORE ${JSON.stringify(v.ratingsReportOnly.before)} → AFTER ${JSON.stringify(v.ratingsReportOnly.after)}. Retained ${v.retention.top14Retained}/14.`,
    `Unknown in top 14 (before → after): energy+danceability ${v.unknownTop14.before.noEnergyDance} → ${v.unknownTop14.after.noEnergyDance}; popularity ${v.unknownTop14.before.noPopularity} → ${v.unknownTop14.after.noPopularity}; community ${v.unknownTop14.before.noCommunity} → ${v.unknownTop14.after.noCommunity}.`,
    `Removed: ${v.changed.removed.join("; ") || "none"}. Added: ${v.changed.added.join("; ") || "none"}.`, "",
    "| Track | Before rank/score | After rank/score | Rating only | After reasons |", "|---|---|---|---|---|",
    ...v.after.map(r => { const b = v.before.find(x => x.track === r.track); return `| ${r.track.replaceAll("|", " – ")} | ${b?.rank ?? "excluded"}/${b?.score ?? "—"} | ${r.rank}/${r.score} | ${r.ratingReportOnly ?? "—"} | ${r.reasons.replaceAll("|", "/")} |`; }), ""].join("\n");
  return [`# Community (Last.fm exact-track) evidence comparison`, "", `BEFORE scorer frozen at ${d.beforeSource}. Same pool and evidence both sides. No-fit unchanged: archived31 ${d.noFitUnchanged.archived31}, held-out ${d.noFitUnchanged.heldOut}. Full data in community.json.`, "",
    ...d.limitations.map(l => `- ${l}`), "", sec("Original archived 31", d.archived31), sec("Latest published 14 (exact spellings, Ava Max replacing Let It Be)", d.latest14Exact),
    "## Held-out renamed synthetic provider cases", "", ...d.heldOut.cases.map(c => `- ${c.id}: ${c.track} → ${c.parsedCommunity ? JSON.stringify(c.parsedCommunity) : "no usable evidence (unknown)"}`), "",
    sec("Held-out: familiar + avoid slow", d.heldOut.familiarAvoidSlow), sec("Held-out: avoid slow only", d.heldOut.avoidSlowOnly), sec("Held-out: discovery (control)", d.heldOut.discovery)].join("\n");
}
