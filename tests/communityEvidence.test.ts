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

import { providerQueryTitle, readListeners } from "../src/lib/prep/communityEvidence";
import { __resetCommunityCache } from "../src/lib/prep/community.functions";
describe("provider query title and listener parsing (review fixes)", () => {
  it("drops only clean/radio labels; keeps remix/live/acoustic/intro/feat and punctuation", () => {
    expect(providerQueryTitle("Freaking Me Out (Clean)")).toBe("Freaking Me Out");
    expect(providerQueryTitle("Stayin' Alive (Clean) (Radio Edit)")).toBe("Stayin' Alive");
    expect(providerQueryTitle("Song - Clean Radio Edit")).toBe("Song");
    expect(providerQueryTitle("Get Down On It (Calvo Remix) (Clean)")).toBe("Get Down On It (Calvo Remix)");
    expect(providerQueryTitle("Can I Kick It (Intro Clean)")).toBe("Can I Kick It (Intro Clean)");
    expect(providerQueryTitle("Yeah! (feat. Lil Jon)")).toBe("Yeah! (feat. Lil Jon)");
    expect(providerQueryTitle("Chasing Cars (Live)")).toBe("Chasing Cars (Live)");
    expect(providerQueryTitle("(Clean)")).toBe("(Clean)");
  });
  it("listeners: absent/null/empty/garbage/negative/unsafe stay unknown, never 0", () => {
    for (const v of [undefined, null, "", " ", "abc", "-5", "1.5", 1.5, -1, 1e10, "99999999999", NaN, Infinity]) expect(readListeners(v)).toBeUndefined();
    expect(readListeners("0")).toBe(0); expect(readListeners("123456")).toBe(123456); expect(readListeners(42)).toBe(42);
    const t = { track: { name: "B", artist: { name: "A" }, listeners: null, toptags: { tag: [{ name: "ballad" }] } } };
    expect(parseCommunityTrackInfo(t, "A", "B")).toBeUndefined();
    const big = { track: { name: "B", artist: { name: "A" }, listeners: "99999999999", toptags: { tag: [] } } };
    expect(parseCommunityTrackInfo(big, "A", "B")).toBeUndefined();
    const ev = parseCommunityTrackInfo({ track: { name: "B", artist: { name: "A" }, listeners: "9999999999", toptags: { tag: [] } } }, "A", "B");
    expect(readCommunity(ev)).toEqual(ev);
  });
});

describe("community transport (synthetic)", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  it("clean/radio request queries the base title, accepts the base reply, keeps original keys; remix never accepts original", async () => {
    __resetCommunityCache();
    const seen: string[] = [];
    const fetcher = (async (u: URL) => { const t = u.searchParams.get("track")!; seen.push(`${u.searchParams.get("artist")}|${t}`);
      return ok(info(u.searchParams.get("artist")!, t.replace(/ \(Calvo Remix\)$/, ""), 500000, ["dance"])); }) as never;
    const r = await runCommunityBatch([{ artist: "Bee Gees", song: "Stayin' Alive (Clean) (Radio Edit)" }, { artist: "Kool & The Gang", song: "Get Down On It (Calvo Remix) (Clean)" }, { artist: "Usher feat. Lil Jon", song: "Yeah!" }], "k", fetcher, 1000, 500);
    expect(seen).toEqual(["Bee Gees|Stayin' Alive", "Kool & The Gang|Get Down On It (Calvo Remix)", "Usher feat. Lil Jon|Yeah!"]);
    expect(r.map(x => [x.song, x.status])).toEqual([["Stayin' Alive (Clean) (Radio Edit)", "found"], ["Get Down On It (Calvo Remix) (Clean)", "none"], ["Yeah!", "found"]]);
  });
  it("fetch and json resolving AFTER the deadlines never write results or poison the cache; no scheduling after stop", async () => {
    __resetCommunityCache();
    const calls: string[] = [];
    const late = (ms: number, v: unknown) => new Promise(r => setTimeout(() => r(v), ms));
    const slowFetch = (async (u: URL) => { const t = u.searchParams.get("track")!; calls.push(t);
      if (t === "SlowFetch") return late(150, ok(info("Z", t, 9e5, ["ballad"])));
      if (t === "SlowJson") return { ok: true, json: () => late(150, info("Z", t, 9e5, ["ballad"])) } as unknown as Response;
      return late(5, ok(info("Z", t, 9e5, []))); }) as never;
    const r = await runCommunityBatch([{ artist: "Z", song: "SlowFetch" }, { artist: "Z", song: "SlowJson" }], "k", slowFetch, 1000, 40);
    expect(r.map(x => x.status)).toEqual(["timeout", "timeout"]);
    // overall deadline: 6 songs, 4 workers, all slow → nothing scheduled after stop
    const r2 = await runCommunityBatch(["SlowFetch", "SlowJson", "A1", "A2", "A3", "A4"].map(song => ({ artist: "Z", song: song === "SlowFetch" ? "SlowFetch" : song })), "k", (async (u: URL) => { calls.push("o:" + u.searchParams.get("track")); return late(200, ok({})); }) as never, 60, 1000);
    expect(r2.every(x => x.status === "timeout")).toBe(true);
    const before = calls.length;
    await late(300, 0);
    expect(calls.length).toBe(before);
    expect(calls.filter(c => c.startsWith("o:"))).toHaveLength(4);
    expect(r2).toEqual(r2.map(x => ({ ...x, status: "timeout" })));
    // same keys again with a fast provider: cache was not poisoned by the late replies
    const r3 = await runCommunityBatch([{ artist: "Z", song: "SlowFetch" }, { artist: "Z", song: "SlowJson" }], "k", (async (u: URL) => ok(info("Z", u.searchParams.get("track")!, 7000, ["dance"]))) as never, 1000, 500);
    expect(r3.map(x => x.evidence?.upbeatTags)).toEqual([["dance"], ["dance"]]);
  });
});

describe("community wall-clock guard (clock advanced without firing timers)", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  const run = async (advance: "fetch" | "json", pastOverall: boolean) => {
    __resetCommunityCache();
    const real = Date.now; let now = real.call(Date);
    const spy = (Date as { now: () => number }); spy.now = () => now;
    try {
      const song = `Clock${advance}${pastOverall}`;
      const fetcher = (async (u: URL) => {
        const body = info("Z", u.searchParams.get("track")!, 7000, ["ballad"]);
        if (advance === "fetch") { now += pastOverall ? 100000 : 5000; return ok(body); }
        return { ok: true, json: async () => { now += pastOverall ? 100000 : 5000; return body; } } as Response;
      }) as never;
      const r = await runCommunityBatch([{ artist: "Z", song }], "k", fetcher, 60000, 1000);
      expect(r[0]!.status).toBe("timeout");
      expect(r[0]!.evidence).toBeUndefined();
      // next lookup for same key must hit the provider again (no poisoned cache)
      let calls = 0;
      const r2 = await runCommunityBatch([{ artist: "Z", song }], "k", (async (u: URL) => { calls++; return ok(info("Z", u.searchParams.get("track")!, 7000, ["dance"])); }) as never, 60000, 1000);
      expect(calls).toBe(1);
      expect(r2[0]!.evidence?.upbeatTags).toEqual(["dance"]);
    } finally { spy.now = real; }
  };
  it("late fetch past per-call cutoff", () => run("fetch", false));
  it("late json past per-call cutoff", () => run("json", false));
  it("late fetch past overall cutoff", () => run("fetch", true));
  it("late json past overall cutoff", () => run("json", true));
});
