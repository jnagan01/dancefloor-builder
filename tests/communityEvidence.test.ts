import { describe, expect, it } from "vitest";
import { parseCommunityTrackInfo, readCommunity, sameTrackIdentity } from "../src/lib/prep/communityEvidence";
import { runCommunityBatch } from "../src/lib/prep/community.functions";
import { evaluateFit, type FitFacts } from "../src/lib/prep/eventFit";
import { recommend, DEFAULT_REC_CONTROLS, type Candidate } from "../src/lib/prep/recommend";

const info = (artist: string, name: string, listeners: number | string, tags: string[]) => ({ track: { name, artist: { name: artist }, listeners: String(listeners), toptags: { tag: tags.map(t => ({ name: t })) } } });

describe("exact-track community evidence parsing", () => {
  it("accepts only the same artist/title/version", () => {
    expect(parseCommunityTrackInfo(info("Held Out Band", "Quiet Hour", 90000, ["ballad", "rock"]), "Held Out Band", "Quiet Hour")).toEqual({ source: "lastfm", listeners: 90000, slowTags: ["ballad"], upbeatTags: [] });
    expect(parseCommunityTrackInfo(info("Other Band", "Quiet Hour", 90000, ["ballad"]), "Held Out Band", "Quiet Hour")).toBeUndefined();
    expect(parseCommunityTrackInfo(info("Held Out Band", "Quiet Hour (Live)", 90000, ["ballad"]), "Held Out Band", "Quiet Hour")).toBeUndefined();
    expect(parseCommunityTrackInfo(info("Held Out Band", "Quiet Hour", 90000, ["ballad"]), "Held Out Band", "Quiet Hour (Acoustic)")).toBeUndefined();
    expect(sameTrackIdentity("Held Out Band", "Quiet Hour (Clean Radio Edit)", "Held Out Band", "Quiet Hour")).toBe(true);
    expect(sameTrackIdentity("Usher feat. Lil Jon", "Yeah!", "Usher", "Yeah! (feat. Lil Jon)")).toBe(true);
    expect(parseCommunityTrackInfo({ artist: { name: "Held Out Band" } }, "Held Out Band", "Quiet Hour")).toBeUndefined();
  });
  it("generic rock/love/sad tags are never slow; tags outside top 5 or with tiny samples do not count", () => {
    expect(parseCommunityTrackInfo(info("A", "B", 90000, ["rock", "love", "sad", "melancholy", "alternative"]), "A", "B")?.slowTags).toEqual([]);
    expect(parseCommunityTrackInfo(info("A", "B", 90000, ["rock", "pop", "indie", "love", "sad", "ballad"]), "A", "B")?.slowTags).toEqual([]);
    expect(parseCommunityTrackInfo(info("A", "B", 4999, ["ballad"]), "A", "B")).toEqual({ source: "lastfm", listeners: 4999, slowTags: [], upbeatTags: [] });
    expect(parseCommunityTrackInfo(info("A", "B", 90000, ["power-ballad", "party"]), "A", "B")).toEqual({ source: "lastfm", listeners: 90000, slowTags: ["power ballad"], upbeatTags: ["party"] });
  });
  it("strict reader for frozen quality samples rejects unknown tags/keys", () => {
    expect(readCommunity({ source: "lastfm", listeners: 5, slowTags: ["ballad"], upbeatTags: [] })).toBeTruthy();
    expect(() => readCommunity({ source: "lastfm", slowTags: ["sad"], upbeatTags: [] })).toThrow();
    expect(() => readCommunity({ source: "lastfm", slowTags: [], upbeatTags: [], energy: 2 })).toThrow();
    expect(() => readCommunity({ source: "spotify", slowTags: [], upbeatTags: [] })).toThrow();
  });
});

describe("bounded community batch", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  it("provider disabled without key: every song unknown/disabled, no calls", async () => {
    let calls = 0;
    const r = await runCommunityBatch([{ artist: "A", song: "B" }], undefined, (async () => { calls++; return ok({}); }) as never);
    expect(r).toEqual([{ artist: "A", song: "B", status: "disabled" }]); expect(calls).toBe(0);
  });
  it("partial results survive a hanging call; wrong-track answer stays none; autocorrect off; late result cannot mutate", async () => {
    const urls: string[] = [];
    const fetcher = (async (u: URL) => { urls.push(String(u)); const t = u.searchParams.get("track");
      if (t === "Hang") return new Promise(() => {});
      if (t === "Wrong") return ok(info("Someone Else", "Wrong", 1e6, ["ballad"]));
      if (t === "Err") return ok({ error: 29, message: "rate" });
      return ok(info("Z1", t!, 2e6, ["dance"])); }) as never;
    const r = await runCommunityBatch([{ artist: "Z1", song: "Hang" }, { artist: "Z1", song: "Fine" }, { artist: "Z1", song: "Wrong" }, { artist: "Z1", song: "Err" }], "k", fetcher, 200, 100);
    expect(r.map(x => x.status)).toEqual(["timeout", "found", "none", "failed"]);
    expect(r[1].evidence).toEqual({ source: "lastfm", listeners: 2e6, slowTags: [], upbeatTags: ["dance"] });
    expect(urls.every(u => u.includes("autocorrect=0"))).toBe(true);
  });
});

const ctx = (cands: Candidate[], fit: { familiarity?: "familiar" | "discovery"; avoidSlow?: boolean } | undefined) => ({ candidates: cands, requests: [{ artist: "Req", song: "Seed" }], inEvent: [], feedback: [], dismissed: [], similar: [], preferences: { genres: [], artists: [], decades: [], ...(fit ? { fit } : {}) }, controls: DEFAULT_REC_CONTROLS, limit: 99 });
const cm = (slow: string[], up: string[] = [], listeners = 100000): FitFacts["community"] => ({ source: "lastfm", listeners, slowTags: slow, upbeatTags: up });

describe("community evidence in shared scoring (held-out renamed synthetic tracks)", () => {
  it("explicit slow tags lower rank, cap similarity and never exclude; measured E/D untouched", () => {
    const r = evaluateFit({ avoidSlow: true }, { origin: "library", fit: { energy: 6, energySource: "estimate", danceability: 6, danceabilitySource: "estimate", community: cm(["ballad"]) } });
    expect(r.exclude).toBeUndefined();
    expect(r.lines).toEqual([expect.objectContaining({ kind: "slowEstimate", points: -2 })]);
    expect(r.similarityCap).toBe(1);
  });
  it("only slow candidates are still returned (estimates never hard-exclude)", () => {
    const out = recommend(ctx([{ ref: 1, artist: "Q", song: "Only", origin: "ai", facts: {}, fit: { community: cm(["slow"]) } }], { avoidSlow: true }));
    expect(out.items.map(i => i.song)).toEqual(["Only"]);
  });
  it("dance/party tags or verified upbeat E/D conflict: no penalty, explained", () => {
    const a = evaluateFit({ avoidSlow: true }, { origin: "ai", fit: { community: cm(["ballad"], ["party"]) } });
    expect(a.lines).toEqual([]); expect(a.uncertain?.join(" ")).toMatch(/conflict/);
    const b = evaluateFit({ avoidSlow: true }, { origin: "ai", fit: { energy: 8, energySource: "provider", danceability: 7, danceabilitySource: "provider", community: cm(["ballad"]) } });
    expect(b.lines).toEqual([]); expect(b.uncertain?.join(" ")).toMatch(/conflict with verified/);
  });
  it("does not double-count when a low-both estimate already applies", () => {
    const r = evaluateFit({ avoidSlow: true }, { origin: "ai", fit: { energy: 3, energySource: "ai", danceability: 3, danceabilitySource: "ai", community: cm(["ballad"]) } });
    expect(r.lines.filter(l => l.kind === "slowEstimate")).toHaveLength(1);
    expect(r.lines[0].points).toBe(-3);
  });
  it("listeners: bounded advisory bonus only under familiar, zero when upbeat fit unsupported; never familiarity evidence", () => {
    const fam = evaluateFit({ familiarity: "familiar" }, { origin: "ai", fit: { community: cm([], [], 3_000_000) } });
    expect(fam.lines).toEqual([expect.objectContaining({ points: 0.5 })]); expect(fam.familiarEvidence).toBe(false);
    expect(evaluateFit({ familiarity: "familiar" }, { origin: "ai", fit: { community: cm([], [], 300_000) } }).lines[0].points).toBe(0.25);
    expect(evaluateFit({ familiarity: "familiar" }, { origin: "ai", fit: { community: cm([], [], 200_000) } }).lines).toEqual([]);
    const slow = evaluateFit({ familiarity: "familiar", avoidSlow: true }, { origin: "ai", fit: { community: cm([], [], 3_000_000) } });
    expect(slow.lines.find(l => /listeners/.test(l.text))?.points).toBe(0);
    expect(evaluateFit({ familiarity: "discovery" }, { origin: "ai", fit: { community: cm([], [], 3_000_000) } }).lines).toEqual([]);
  });
  it("no fit choices: community evidence is a strict no-op", () => {
    const base: Candidate = { ref: 1, artist: "Q", song: "S", origin: "ai", facts: {} };
    expect(recommend(ctx([{ ...base, fit: { community: cm(["ballad"], [], 9e6) } }], undefined)).items[0].score).toBe(recommend(ctx([base], undefined)).items[0].score);
  });
});
