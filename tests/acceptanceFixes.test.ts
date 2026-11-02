import { describe, expect, it } from "vitest";
import { mergeTrackMetadata, carryRescanMetadata, metadataResolver, validSongLength } from "../src/lib/trackMetadataIdentity";
import { recommend, type Candidate, type RecControls } from "../src/lib/prep/recommend";
import { libraryCandidate, selectedTrackIds } from "../src/lib/prep/requestFacts";
import { trackFacts } from "../src/lib/prep/filters";
import { trackIdentity } from "../src/lib/fileIdentity";
import { currentShortfall, generateLists, sectionTargetFor } from "../src/lib/danceFloor";
import type { VdjTrack } from "../src/lib/virtualDj";

const t = (filePath: string, o: Partial<VdjTrack> = {}): VdjTrack => ({ filePath, artist: "Queen", title: "Don't Stop Me Now", ...o });

describe("song length metadata merge", () => {
  it("VirtualDJ refresh adds length to a cached track that had none (seconds, no rescan)", () => {
    const cached = t("/m/q.mp3");
    const resolver = metadataResolver([t("/m/q.mp3", { songLength: "215" })], [cached], {});
    expect(mergeTrackMetadata(cached, resolver.resolve(cached.filePath), true).songLength).toBe("215");
  });
  it("keeps an old known length when the new value is absent", () => {
    expect(mergeTrackMetadata(t("/m/q.mp3", { songLength: "187" }), t("/m/q.mp3"), true).songLength).toBe("187");
  });
  it("zero, NaN and junk stay unknown and never replace a known length", () => {
    for (const bad of ["0", "NaN", "abc", "-5", ""]) {
      expect(validSongLength(bad)).toBeUndefined();
      expect(mergeTrackMetadata(t("/m/q.mp3"), t("/m/q.mp3", { songLength: bad }), true).songLength).toBeUndefined();
      expect(mergeTrackMetadata(t("/m/q.mp3", { songLength: "187" }), t("/m/q.mp3", { songLength: bad }), true).songLength).toBe("187");
    }
  });
  it("rescan carries a saved length forward", () => {
    expect(carryRescanMetadata(t("/m/q.mp3"), t("/m/q.mp3", { songLength: "200" })).songLength).toBe("200");
    expect(carryRescanMetadata(t("/m/q.mp3"), undefined, t("/m/q.mp3", { songLength: "201" })).songLength).toBe("201");
    expect(trackFacts(t("/m/q.mp3", { songLength: "215" })).durationSec).toBe(215);
  });
});

describe("recommendations skip files already selected in the event", () => {
  const controls: RecControls = { familiarity: 0, clientSimilarity: 1, artistVariety: 0, ownedOnly: false };
  const clean = t("Music/Queen - Don't Stop Me Now (Clean).mp3", { title: "Don't Stop Me Now (Clean)" });
  const sameBase = t("Other/Queen - Don't Stop Me Now (Clean).mp3", { title: "Don't Stop Me Now (Clean)" });
  const live = t("Music/Queen - Don't Stop Me Now (Live).mp3", { title: "Don't Stop Me Now (Live)" });
  const extra = t("Music/Queen - Bicycle Race.mp3", { title: "Bicycle Race" });
  const tracks = [clean, sameBase, live, extra];
  const cands: Candidate[] = tracks.map(x => libraryCandidate(x, trackIdentity(x.filePath, {})));
  const request = { artist: "Queen", song: "Don't Stop Me Now" };
  const run = (matches: Record<string, { trackIndex?: number; extraTrackIndices?: number[] }>) => {
    const ids = selectedTrackIds([{ key: "warmUp", songs: [request] }], matches, (s, i) => `${s}:${i}`, tracks, {});
    return recommend({ candidates: cands, requests: [request], inEvent: [request], inEventTrackIds: ids, feedback: [], dismissed: [], controls });
  };
  it("title-suffix mismatch: the exact selected file is hidden, other copies and versions remain", () => {
    const out = run({ "warmUp:0": { trackIndex: 0 } });
    const files = out.items.map(r => r.trackId);
    expect(files).not.toContain(trackIdentity(clean.filePath, {}));
    expect(files).toContain(trackIdentity(sameBase.filePath, {}));
    expect(files).toContain(trackIdentity(live.filePath, {}));
    expect(out.hidden.inEvent).toBe(1);
  });
  it("explicitly selected extra files are hidden too", () => {
    const out = run({ "warmUp:0": { trackIndex: 0, extraTrackIndices: [3] } });
    expect(out.items.map(r => r.trackId)).not.toContain(trackIdentity(extra.filePath, {}));
    expect(out.hidden.inEvent).toBe(2);
  });
  it("identity is case-sensitive", () => {
    const ids = selectedTrackIds([{ key: "warmUp", songs: [request] }], { "warmUp:0": { trackIndex: 0 } }, (s, i) => `${s}:${i}`, tracks, {});
    expect(ids.has(trackIdentity(clean.filePath.toLowerCase(), {}))).toBe(false);
  });
});

describe("shortfall labels follow the current lists", () => {
  it("adding one song to a short section reduces the gap by one using the generated target", () => {
    const r = generateLists({ uploaded: [], hours: 0.25, buffer: 2, expand: false, prefs: { artists: [], genres: [], decades: [], notes: "" } });
    const target = sectionTargetFor(r, "warmUp");
    const one = { ...r, warmUp: [{ artist: "A", song: "1" }], transition: [], peak: [] };
    const two = { ...one, warmUp: [...one.warmUp, { artist: "B", song: "2" }] };
    expect(currentShortfall(one).warmUp).toBe(target - 1);
    expect(currentShortfall(two).warmUp).toBe(target - 2);
    expect(currentShortfall(two, ["warmUp"]).total).toBe(target - 2);
    expect(currentShortfall({ ...two, warmUp: Array(target + 3).fill(one.warmUp[0]) }).warmUp).toBe(0);
  });
});
