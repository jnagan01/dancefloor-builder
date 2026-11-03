import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { preventAutomaticDuplicates, sectionCoverage } from "@/lib/preparationDuplicates";
import { generateLists, dedupeKey } from "@/lib/danceFloor";
import { exportReadiness } from "@/lib/exportReadiness";
import { buildLibrary, matchSong, searchLibraryBySong, searchLibraryScored, buildM3u } from "@/lib/virtualDj";
import { makeSubject, scorePair, parseTitle } from "@/lib/matchCore";
import { buildDashboard } from "@/lib/prep/dashboard";
const core = createRequire(import.meta.url)("../desktop/offline/core.js");
const base = { artist: "Stevie Wonder", song: "Signed, Sealed, Delivered I'm Yours", fromUpload: true };
const variant = { artist: base.artist, song: "Signed, Sealed, Delivered (I'm Yours)", fromUpload: false };
const prefs = { artists: [], genres: [], decades: [], notes: "", doNotPlay: [] };
describe("preparation trial identities and unique coverage", () => {
  it("punctuation additions disappear across sections, requests and distinct versions remain", () => {
    const r = generateLists({ uploaded: [], hours: 1, expand: false, prefs });
    r.warmUp = [base]; r.transition = [variant, { ...variant, song: `${variant.song} (Live)` }];
    const before = structuredClone(r);
    const out = preventAutomaticDuplicates(r, s => s.song.includes("Live") ? "/music/Live.mp3" : "/music/Clean.mp3");
    expect(out.transition.map(s => s.song)).toEqual([`${variant.song} (Live)`]);
    expect(out.warmUp).toEqual([base]); expect(r).toEqual(before);
  });
  it("exact owned identity prevents differently named additions, not case-only files", () => {
    const r = generateLists({ uploaded: [], hours: 1, expand: false, prefs });
    r.warmUp = [base]; r.peak = [{ artist: "Other", song: "Alias" }, { artist: "Another", song: "Distinct" }];
    const out = preventAutomaticDuplicates(r, s => s.song === "Distinct" ? "/music/clean.mp3" : "/music/Clean.mp3");
    expect(out.peak.map(s => s.song)).toEqual(["Distinct"]);
  });
  it("explicit generation preserves repeated client rows", () => {
    const out = generateLists({ uploaded: [base, { ...variant, fromUpload: true }], preserveRequestedRows: true, hours: 1, expand: false, prefs });
    expect([...out.warmUp, ...out.transition, ...out.peak]).toHaveLength(2);
  });
  it("primary/extras repeats count unique duration once with exact case preserved, exclusions and clean blocks omitted", () => {
    const lib = buildLibrary([
      { artist: "A", title: "Hit (Clean)", filePath: "/m/Clean.mp3", songLength: "200" },
      { artist: "A", title: "Hit (Extended Clean)", filePath: "/m/Extended.mp3", songLength: "300" },
      { artist: "A", title: "Hit (Clean)", filePath: "/m/clean.mp3" },
      { artist: "A", title: "Hit (Dirty)", filePath: "/m/Dirty.mp3", songLength: "999" },
    ]);
    const refs = [0, 0, 2, 3].map((trackIndex, index) => ({ song: base, requireClean: true, identity: { section: index ? "peak" as const : "warmUp" as const, index, key: String(index) }, match: { status: "Manually Matched" as const, confirmed: true, confidence: 1, alternatives: [], trackIndex, ...(index === 0 ? { extraTrackIndices: [1] } : {}) } }));
    const report = exportReadiness(refs, lib);
    expect(report).toMatchObject({ approved: 4, uniqueTracks: 3, duplicateCount: 1, knownSec: 500, unknownLength: 1, cleanBlocked: 1 });
    expect(report.duplicates[0].first.identity?.section).toBe("warmUp");
    expect(buildM3u(refs.slice(0,1), lib, {})).toContain("/m/Extended.mp3");
    const resolved = refs.map((r,i) => i === 1 ? { ...r, match: { ...r.match, excludedFromVdj: true } } : r);
    expect(exportReadiness(resolved, lib)).toMatchObject({ duplicateCount: 0, excluded: 1, knownSec: 500 });
  });
  it("offline plan flags repeats without silently removing entries or altering snapshots", () => {
    const lists = { warmUp: [base], transition: [variant], peak: [], selections: {
      [`warmUp:0:${dedupeKey(base.artist,base.song)}`]: { paths: ["/m/Clean.mp3"], confirmed: true },
      [`transition:0:${dedupeKey(variant.artist,variant.song)}`]: { paths: ["/m/Clean.mp3"], confirmed: true },
    } };
    const before = structuredClone(lists);
    const plan = core.exportPlan({ lists }, {}, core.buildIndex([{ artist: base.artist, title: base.song, filePath: "/m/Clean.mp3", songLength: "200" }]), {}, {"/m/Clean.mp3":"available"});
    expect(plan.summary).toMatchObject({ approved: 2, uniqueTracks: 1, duplicateCount: 1, knownSec: 200 });
    expect(lists).toEqual(before);
  });
  it("dashboard never counts repeated eligible primary/extra minutes twice", () => {
    const dash = buildDashboard([{key:"warmUp",label:"Warm Up",songs:[base]},{key:"transition",label:"Transition",songs:[variant]}], {
      warmUp: { status:"Matched", confidence:1, confirmed:true, trackIndex:0, alternatives:[] },
      transition: { status:"Matched", confidence:1, confirmed:true, trackIndex:0, extraTrackIndices:[1], alternatives:[] },
    }, s => s, i => ({fileIdentity:`/m/${i}.mp3`,durationSec:i ? 300 : 200}));
    expect(dash.totals).toMatchObject({ confirmed:2, knownSec:500 });
    expect(dash.sections[1].knownSec).toBe(300); expect(dash.sections[1].pending[0].detail).toContain("Repeated");
  });
  it("custom event times, buffer and background targets never imply doubled event time", () => {
    expect(sectionCoverage(300,10,2)).toMatchObject({targetSec:600,prepSec:1200,delta:-900});
    expect(sectionCoverage(300,10,2).text).toContain("event 10:00 · preparation 20:00 · 15:00 short");
    expect(sectionCoverage(900,10,1).text).toContain("5:00 over");
  });
});
describe("artist/title/version evidence", () => {
  it("keyword and filename fallback relevance never leaks into intended-track confidence", () => {
    const artist = "Silk City & Dua Lipa", title = "Electricity";
    const lib = buildLibrary([
      {artist:"Jack Harlow",title:"Dua Lipa",filePath:"/m/Silk City Dua Lipa Electricity.mp3"},
      {artist,title,filePath:"/m/original.mp3"},
      {artist,title:"Electricity (Extended)",filePath:"/m/extended.mp3"},
    ]);
    // Filename discovery deliberately includes the wrong recording. It is
    // useful in free-text search but below the matcher's ranking threshold.
    expect(searchLibraryScored(`${artist} ${title}`, lib).find(r=>r.i===0)?.s).toBe(.6);
    const pair = scorePair(makeSubject(artist,title),lib.subjects[0]);
    expect(pair.score).toBeLessThan(.4);
    expect(pair.reason).toBe("Artist differs from request");
    const results=searchLibraryBySong(artist,title,lib);
    expect(results.map(r=>r.i)).toEqual([1,2,0]);
    expect(results.find(r=>r.i===0)?.s).toBe(pair.score);
    expect(matchSong({artist,song:title},lib).trackIndex).toBe(1);
  });
  it("non-version parentheses retain identity words", () => {
    expect(parseTitle(variant.song).base).toBe(parseTitle(base.song).base);
  });
  it.each([
    ["Queen","Radio Ga Ga","Rammstein","RADIO"],
    ["Silk City & Dua Lipa","Electricity","Jack Harlow","Dua Lipa"],
    ["Original Artist","Shared Title","Unrelated Band","Shared Title"],
  ])("cross-artist/title collisions never become strong matches: %s", (artist,title,other,otherTitle) => {
    expect(scorePair(makeSubject(artist,title),makeSubject(other,otherTitle)).score).toBeLessThan(.62);
    expect(scorePair(makeSubject(artist,title),makeSubject(other,otherTitle)).reason).toBeTruthy();
    const lib = buildLibrary([{artist:other,title:otherTitle,filePath:"/m/wrong.mp3"},{artist,title:`${title} (Extended)`,filePath:"/m/extended.mp3"},{artist,title,filePath:"/m/original.mp3"}]);
    expect(matchSong({artist,song:title},lib).trackIndex).toBe(2);
    expect(searchLibraryBySong(artist,title,lib).map(r=>r.i)[0]).toBe(2);
    expect(searchLibraryBySong(artist,title,lib).find(r=>r.i===0)?.s ?? 0).toBeLessThan(.62);
    expect(matchSong({artist,song:`${title} (Extended)`},lib).trackIndex).toBe(1);
  });
});