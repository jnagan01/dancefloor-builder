import { describe, it, expect } from "vitest";
import {
  buildRecommendExisting,
  getInitialWorkflowState,
  nextWorkflowInstanceId,
} from "@/lib/workflowIsolation";

type Song = { artist: string; song: string };

const workflowA = {
  warmUp: [
    { artist: "A-Warm-1", song: "wa1" },
    { artist: "A-Warm-2", song: "wa2" },
  ] satisfies Song[],
  transition: [{ artist: "A-Trans", song: "at1" }] satisfies Song[],
  peak: [{ artist: "A-Peak", song: "ap1" }] satisfies Song[],
};

const workflowB = {
  warmUp: [{ artist: "B-Warm", song: "bw1" }] satisfies Song[],
  transition: [{ artist: "B-Trans", song: "bt1" }] satisfies Song[],
  peak: [
    { artist: "B-Peak-1", song: "bp1" },
    { artist: "B-Peak-2", song: "bp2" },
  ] satisfies Song[],
};

describe("buildRecommendExisting (AI payload isolation)", () => {
  it("only contains songs from the workflow passed in", () => {
    const existingA = buildRecommendExisting(workflowA);
    const existingB = buildRecommendExisting(workflowB);

    const artistsA = new Set(existingA.map((e) => e.artist));
    const artistsB = new Set(existingB.map((e) => e.artist));

    // Workflow B's AI payload must not mention any workflow-A artist.
    for (const a of artistsA) expect(artistsB.has(a)).toBe(false);
    // And vice-versa.
    for (const b of artistsB) expect(artistsA.has(b)).toBe(false);
  });

  it("returns an empty list for a fresh (empty) workflow", () => {
    expect(buildRecommendExisting({ warmUp: [], transition: [], peak: [] })).toEqual([]);
  });

  it("does not retain references to the input arrays (mutating result is safe)", () => {
    const lists = {
      warmUp: [{ artist: "X", song: "x1" }] satisfies Song[],
      transition: [] as Song[],
      peak: [] as Song[],
    };
    const out = buildRecommendExisting(lists);
    out.push({ artist: "INJECTED", song: "leak" });
    // Mutating the returned payload must not feed back into the source lists.
    expect(lists.warmUp).toHaveLength(1);
    expect(lists.warmUp[0]).toEqual({ artist: "X", song: "x1" });
  });

  it("projects to only artist/song (no extra fields leak into the prompt)", () => {
    const lists = {
      warmUp: [
        { artist: "X", song: "x1", aiReason: "secret notes", energy: 9, fromUpload: true } as Song & Record<string, unknown>,
      ],
      transition: [] as Song[],
      peak: [] as Song[],
    };
    const out = buildRecommendExisting(lists);
    expect(Object.keys(out[0]).sort()).toEqual(["artist", "song"]);
  });
});

describe("getInitialWorkflowState (reset baseline)", () => {
  it("clears every workflow-scoped field", () => {
    const s = getInitialWorkflowState();
    expect(s.songs).toEqual([]);
    expect(s.matches).toEqual({});
    expect(s.result).toBeNull();
    expect(s.searchOpen).toBeNull();
    expect(s.searchQuery).toBe("");
    expect(s.previewTarget).toBeNull();
    expect(s.isGenerating).toBe(false);
    expect(s.expand).toBe(false);
    expect(s.includeCombined).toBe(false);
    expect(s.eventName).toBe("");
    expect(s.artistsInput).toBe("");
    expect(s.genresInput).toBe("");
    expect(s.notes).toBe("");
    expect(s.doNotPlayInput).toBe("");
  });

  it("returns a fresh object each call (no shared mutable references)", () => {
    const a = getInitialWorkflowState();
    const b = getInitialWorkflowState();
    expect(a).not.toBe(b);
    expect(a.matches).not.toBe(b.matches);
    expect(a.decades).not.toBe(b.decades);
    // Mutating one initial state must not pollute the next.
    (a.matches as Record<string, unknown>)["leaked"] = { from: "workflowA" };
    expect(getInitialWorkflowState().matches).toEqual({});
  });
});

describe("nextWorkflowInstanceId (UI re-key boundary)", () => {
  it("strictly increases so React drops workflow-scoped component state", () => {
    let id = 0;
    const ids = new Set<number>();
    for (let i = 0; i < 5; i++) {
      id = nextWorkflowInstanceId(id);
      ids.add(id);
    }
    expect(ids.size).toBe(5);
    // Monotonic increase guarantees the React key changes at every boundary.
    expect(id).toBe(5);
  });
});

describe("end-to-end isolation: switching workflows", () => {
  // Simulates the sequence: generate in workflow A → reset → load workflow B
  // → generate again. The AI payload built after the switch must contain
  // only workflow B's songs.
  it("after reset + load B, the recommend payload contains zero workflow-A songs", () => {
    // 1. Workflow A is active.
    const existingDuringA = buildRecommendExisting(workflowA);
    expect(existingDuringA.length).toBeGreaterThan(0);

    // 2. User clicks "New workflow": state is cleared.
    const cleared = getInitialWorkflowState();
    const existingAfterReset = buildRecommendExisting({
      warmUp: [],
      transition: [],
      peak: [],
    });
    expect(existingAfterReset).toEqual([]);
    expect(cleared.matches).toEqual({});

    // 3. User loads workflow B from history and generates.
    const existingDuringB = buildRecommendExisting(workflowB);
    const artistsA = new Set(existingDuringA.map((e) => e.artist));
    for (const entry of existingDuringB) {
      expect(artistsA.has(entry.artist)).toBe(false);
    }
  });
});
