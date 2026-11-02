import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import * as vdj from "@/lib/virtualDj"; import * as bridge from "@/lib/desktopBridge"; import * as audio from "@/lib/audioMatch"; import * as identity from "@/lib/fileIdentity"; import * as metadata from "@/lib/trackMetadataIdentity"; import * as cache from "@/lib/workspaceFileCache"; import * as safety from "@/lib/nativeScanSafety"; import * as workspaceIndexes from "@/lib/workspaceIndexes"; import * as trackRevisions from "@/lib/trackRevisions"; import * as backups from "@/lib/backups";
import { createPrepStore, type PrepBackend } from "@/lib/prep/prepStore";
import { emptyKnowledge, setFeedback, addShortlist } from "@/lib/prep/knowledge";

const require = createRequire(import.meta.url);
const { harness, deferred } = require("./helpers/workspaceHarness.cjs").createHarnessModules({ vdj, bridge, audio, identity, metadata, cache, safety, workspaceIndexes, trackRevisions, backups });
const source = { label: "Synthetic", tracks: [{ filePath: "Synthetic/song.mp3", artist: "A", title: "Original" }] };
const mem = (initial: Record<string, unknown> = {}): PrepBackend & { data: Map<string, unknown> } => { const data = new Map(Object.entries(initial)); return { data, read: async k => structuredClone(data.get(k)), write: async (k, v) => { data.set(k, structuredClone(v)); } }; };
async function setup(initial: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  const be = mem(initial), store = createPrepStore(be); await store.setAccount("synthetic");
  const saved: backups.Backup[] = [];
  const h = harness([source], false, { saved, prepStore: { prepStore: () => store }, ...opts });
  return { be, store, saved, h };
}

describe("actual Workspace backup with preparation notes", () => {
  it("includes preparation notes in the saved backup", async () => {
    const { store, saved, h } = await setup();
    await store.update(store.owner()!, k => setFeedback(k, "A", "T", "favor"));
    await h.render().backup();
    expect(saved[0].prep?.feedback).toHaveLength(1);
  });
  it("unreadable preparation notes block the backup (and so the update preservation step) instead of omitting them", async () => {
    const { saved, h, be } = await setup({ "prepKnowledge:synthetic": { version: 1, presets: "corrupt" } });
    await expect(h.render().backup()).rejects.toThrow(/Backup stopped/);
    expect(saved).toEqual([]);
    expect(be.data.get("prepKnowledge:synthetic")).toEqual({ version: 1, presets: "corrupt" });
  });
  it("sign-in again during a backup invalidates it before rerender", async () => {
    const d = deferred(); const { saved, h } = await setup({}, { query: () => d.promise });
    const p = h.render().backup(); h.session("synthetic"); d.resolve({ data: [], error: null });
    await expect(p).rejects.toThrow(/changed/);
    expect(saved).toEqual([]);
  });
  it("sign-out revokes preparation access immediately", async () => {
    const { store, h } = await setup();
    const old = store.owner()!;
    h.session(null);
    expect(store.get().status).toBe("signedOut");
    await expect(store.update(old, k => setFeedback(k, "A", "T", "never"))).rejects.toThrow(/changed/);
  });
  it("restores preparation-only data with zero library additions, after a fresh backup, additively", async () => {
    const { store, saved, h } = await setup();
    await store.update(store.owner()!, k => setFeedback(k, "A", "T", "favor"));
    const incoming = addShortlist(setFeedback(setFeedback(emptyKnowledge(), "A", "T", "never"), "B", "U", "never"), "E1", { artist: "C", song: "V" }).next;
    const b: backups.Backup = { format: "setarchitect-backup", version: 1, account: "synthetic", createdAt: new Date().toISOString(), events: [], sources: [source], roots: {}, prep: incoming };
    expect(await h.render().restorePrep(b)).toBe(2);
    expect(saved).toHaveLength(1); // pre-restore backup taken first
    const k = store.get().knowledge;
    expect(k.feedback.find(f => f.label === "A – T")?.kind).toBe("favor");
    expect(k.events[0].shortlist[0].song).toBe("V");
    expect(h.render().sources).toEqual([source]);
  });
  it("a startup backup that runs before preparation notes have loaded waits for them instead of failing", async () => {
    const be = mem({ "prepKnowledge:synthetic": setFeedback(emptyKnowledge(), "A", "T", "favor") }); const store = createPrepStore(be); // not yet loaded
    const saved: backups.Backup[] = [];
    const h = harness([source], false, { saved, prepStore: { prepStore: () => store } });
    await h.render().backup();
    expect(saved[0].prep?.feedback).toHaveLength(1);
  });
});
