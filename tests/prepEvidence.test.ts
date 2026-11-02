import { describe, expect, it } from "vitest";
import { recommend, type Candidate } from "../src/lib/prep/recommend";
import { libraryCandidate, requestFacts } from "../src/lib/prep/requestFacts";
import { EMPTY_FILTER, trackFacts } from "../src/lib/prep/filters";
import type { SongMatch, VdjTrack } from "../src/lib/virtualDj";

const track = (o: Partial<VdjTrack>): VdjTrack => ({ filePath: "/s/a.mp3", artist: "A", title: "T", ...o } as VdjTrack);
const cand = (song: string, playCount: number | undefined): Candidate => ({ artist: song, song, facts: trackFacts(track({ title: song })), playCount, origin: "library" });
const run = (cands: Candidate[], requests: { artist: string; song: string; genre?: string; decade?: string }[] = []) =>
  recommend({ candidates: cands, requests, inEvent: [], feedback: [], dismissed: [], similar: new Map(), controls: { familiarity: -1, clientSimilarity: 1, artistVariety: 0 }, filter: EMPTY_FILTER, limit: 10 });

describe("recommendation play-history evidence", () => {
  it("only an explicit zero play count earns the 'never played' discovery reason", () => {
    const r = run([cand("Zero", 0), cand("Unknown", undefined)]);
    const ev = (s: string) => r.items.find(i => i.song === s)!.evidence.map(e => e.kind);
    expect(ev("Zero")).toContain("discovery");
    expect(ev("Unknown")).not.toContain("discovery");
  });
  it("library candidates keep missing play history unknown and explicit zero as zero", () => {
    expect(libraryCandidate(track({}), "id").playCount).toBeUndefined();
    expect(libraryCandidate(track({ playCount: 0 }), "id").playCount).toBe(0);
    const r = run([libraryCandidate(track({ title: "NoHistory" }), "a")]);
    expect(r.items[0].evidence.map(e => e.kind)).not.toContain("discovery");
  });
});

describe("client request taste facts", () => {
  const tracks = [track({ genre: "Metal", year: "1985" })];
  const song = { artist: "Client", song: "Request" };
  it("use an approved linked track's genre/decade", () => {
    const m = { trackIndex: 0, status: "Matched", confirmed: true } as SongMatch;
    expect(requestFacts(song, m, tracks)).toMatchObject({ genre: "Metal", decade: "1980s" });
  });
  it("ignore an unapproved candidate's metadata", () => {
    const m = { trackIndex: 0, status: "Multiple Matches" } as SongMatch;
    const f = requestFacts(song, m, tracks);
    expect(f.genre).toBeUndefined(); expect(f.decade).toBeUndefined();
    const rec = run([{ ...cand("X", 3), facts: trackFacts(track({ genre: "Metal", title: "X" })) }], [f]);
    expect(rec.items[0].evidence.map(e => e.kind)).not.toContain("genre");
  });
  it("ignore an approved match pointing at a missing library entry", () => {
    expect(requestFacts(song, { trackIndex: 5, status: "Matched", confirmed: true } as SongMatch, tracks).genre).toBeUndefined();
  });
});
