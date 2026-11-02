import { readFilter, type FilterContext, type FilterState } from "./filters";

/**
 * Account-scoped preparation knowledge. App-only: nothing here is written into
 * audio files, event snapshots or the cloud. Collections are arrays (never
 * user-keyed dictionaries) so backup private-field policy stays unchanged.
 */
export type ShortStatus = "considering" | "selected" | "obtain";
export interface FilterPreset { id: string; name: string; context: FilterContext; filter: FilterState }
export interface TrackNote { id: string; tags: string[]; note: string; updatedAt: number }
export interface GroupItem { artist: string; song: string; trackId?: string; versionNote?: string }
export interface TrackGroup { id: string; name: string; items: GroupItem[] }
/** Global preference by exact song identity: "never" hides from all recommendations, "favor" boosts. */
export interface Feedback { key: string; label: string; kind: "never" | "favor"; at: number }
export interface Dismissal { key: string; label: string; at: number }
export interface ShortItem { id: string; artist: string; song: string; status: ShortStatus; versionNote: string; trackId?: string; addedAt: number }
export interface EventPrep { eventId: string; dismissed: Dismissal[]; shortlist: ShortItem[] }
export interface Enrichment { key: string; source: "musicbrainz" | "lastfm"; label: string; url?: string; data: Record<string, string | number | string[]>; fetchedAt: number }
export interface PrepKnowledge {
  version: 1; presets: FilterPreset[]; tracks: TrackNote[]; groups: TrackGroup[];
  feedback: Feedback[]; events: EventPrep[]; enrichment: Enrichment[];
}
export const emptyKnowledge = (): PrepKnowledge => ({ version: 1, presets: [], tracks: [], groups: [], feedback: [], events: [], enrichment: [] });

export const LIMITS = { presets: 100, tracks: 50000, groups: 500, groupItems: 2000, feedback: 20000, events: 1000, shortlist: 2000, dismissed: 5000, enrichment: 5000, tags: 30, note: 4000, name: 120 };

/** Exact song identity: case/space-folded artist|title, keeping remix/edit words so versions never merge. */
export const songIdentity = (artist: string, song: string) =>
  `${artist.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()}|${song.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()}`;
/** Shortlist/group identity: a linked file wins; otherwise exact song identity plus desired version note. */
export const itemIdentity = (i: { artist: string; song: string; trackId?: string; versionNote?: string }) =>
  i.trackId ? `file:${i.trackId}` : `song:${songIdentity(i.artist, i.song)}#${(i.versionNote ?? "").toLowerCase().trim()}`;

const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !v.includes("\0") ? v : null;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const arr = (v: unknown, max: number) => Array.isArray(v) && v.length <= max ? v : null;
const STATUSES: ShortStatus[] = ["considering", "selected", "obtain"];

/** Strict read: returns null for anything not produced by this schema (caller preserves the original bytes). */
export function readKnowledge(v: unknown): PrepKnowledge | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return null;
  try {
    const presets = arr(o.presets, LIMITS.presets)?.map(p => {
      const filter = readFilter(p?.filter), id = str(p?.id, 80), name = str(p?.name, LIMITS.name);
      if (!filter || !id || !name || (p.context !== "library" && p.context !== "recommendation")) throw 0;
      return { id, name, context: p.context, filter } as FilterPreset;
    });
    const tracks = arr(o.tracks, LIMITS.tracks)?.map(t => {
      const id = str(t?.id, 4000), note = str(t?.note, LIMITS.note), tags = arr(t?.tags, LIMITS.tags), at = num(t?.updatedAt);
      if (!id || note === null || !tags || at === null || !tags.every(x => str(x, 60))) throw 0;
      return { id, note, tags: tags as string[], updatedAt: at };
    });
    const item = (i: Record<string, unknown>): GroupItem => {
      const artist = str(i?.artist, 300), song = str(i?.song, 300);
      if (artist === null || song === null) throw 0;
      const out: GroupItem = { artist, song };
      if (i.trackId !== undefined) { const t = str(i.trackId, 4000); if (!t) throw 0; out.trackId = t; }
      if (i.versionNote !== undefined) { const t = str(i.versionNote, 300); if (t === null) throw 0; out.versionNote = t; }
      return out;
    };
    const groups = arr(o.groups, LIMITS.groups)?.map(g => {
      const id = str(g?.id, 80), name = str(g?.name, LIMITS.name), items = arr(g?.items, LIMITS.groupItems);
      if (!id || !name || !items) throw 0;
      return { id, name, items: items.map(item) };
    });
    const feedback = arr(o.feedback, LIMITS.feedback)?.map(f => {
      const key = str(f?.key, 700), label = str(f?.label, 700), at = num(f?.at);
      if (!key || label === null || at === null || (f.kind !== "never" && f.kind !== "favor")) throw 0;
      return { key, label, kind: f.kind, at } as Feedback;
    });
    const events = arr(o.events, LIMITS.events)?.map(e => {
      const eventId = str(e?.eventId, 200), dismissed = arr(e?.dismissed, LIMITS.dismissed), shortlist = arr(e?.shortlist, LIMITS.shortlist);
      if (!eventId || !dismissed || !shortlist) throw 0;
      return {
        eventId,
        dismissed: dismissed.map(d => { const key = str(d?.key, 700), label = str(d?.label, 700), at = num(d?.at); if (!key || label === null || at === null) throw 0; return { key, label, at }; }),
        shortlist: shortlist.map(s => {
          const base = item(s), id = str(s?.id, 80), at = num(s?.addedAt), note = str(s?.versionNote ?? "", 300);
          if (!id || at === null || note === null || !STATUSES.includes(s.status)) throw 0;
          return { ...base, id, status: s.status, versionNote: note, addedAt: at } as ShortItem;
        }),
      };
    });
    const enrichment = arr(o.enrichment, LIMITS.enrichment)?.map(x => {
      const key = str(x?.key, 700), label = str(x?.label, 700), at = num(x?.fetchedAt);
      if (!key || label === null || at === null || (x.source !== "musicbrainz" && x.source !== "lastfm") || !x.data || typeof x.data !== "object" || Array.isArray(x.data)) throw 0;
      const data: Enrichment["data"] = {};
      for (const [k, val] of Object.entries(x.data as Record<string, unknown>)) {
        if (typeof val === "string" && val.length <= 2000) data[k] = val; else if (typeof val === "number" && Number.isFinite(val)) data[k] = val;
        else if (Array.isArray(val) && val.length <= 50 && val.every(t => typeof t === "string" && t.length <= 200)) data[k] = val as string[]; else throw 0;
      }
      const out: Enrichment = { key, source: x.source, label, data, fetchedAt: at };
      if (x.url !== undefined) { const u = str(x.url, 500); if (!u || !/^https:\/\/(musicbrainz\.org|www\.last\.fm)\//.test(u)) throw 0; out.url = u; }
      return out;
    });
    if (!presets || !tracks || !groups || !feedback || !events || !enrichment) return null;
    return { version: 1, presets, tracks, groups, feedback, events, enrichment };
  } catch { return null; }
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const cleanName = (n: string) => n.replace(/[\r\n\t]+/g, " ").trim().slice(0, LIMITS.name);

// ---- pure mutations (each returns a new object; the input is never modified) ----
export function savePreset(k: PrepKnowledge, name: string, context: FilterContext, filter: FilterState): PrepKnowledge {
  const n = cleanName(name); if (!n) throw Error("Name the preset.");
  if (k.presets.length >= LIMITS.presets) throw Error("Preset limit reached.");
  return { ...k, presets: [...k.presets, { id: uid(), name: n, context, filter: structuredClone(filter) }] };
}
export const renamePreset = (k: PrepKnowledge, id: string, name: string): PrepKnowledge => {
  const n = cleanName(name); if (!n) throw Error("Name the preset.");
  return { ...k, presets: k.presets.map(p => p.id === id ? { ...p, name: n } : p) };
};
export const deletePreset = (k: PrepKnowledge, id: string): PrepKnowledge => ({ ...k, presets: k.presets.filter(p => p.id !== id) });

export const normTags = (tags: string[]) => [...new Set(tags.map(t => t.replace(/[\r\n,]+/g, " ").trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, LIMITS.tags);
export function setTrackNote(k: PrepKnowledge, id: string, patch: { tags?: string[]; note?: string }): PrepKnowledge {
  const old = k.tracks.find(t => t.id === id);
  const next: TrackNote = { id, tags: patch.tags ? normTags(patch.tags) : old?.tags ?? [], note: (patch.note ?? old?.note ?? "").slice(0, LIMITS.note), updatedAt: Date.now() };
  const rest = k.tracks.filter(t => t.id !== id);
  return { ...k, tracks: next.tags.length || next.note.trim() ? [...rest, next] : rest };
}

export function createGroup(k: PrepKnowledge, name: string, items: GroupItem[] = []): PrepKnowledge {
  const n = cleanName(name); if (!n) throw Error("Name the group.");
  return { ...k, groups: [...k.groups, { id: uid(), name: n, items: dedupeItems(items) }] };
}
export const renameGroup = (k: PrepKnowledge, id: string, name: string): PrepKnowledge => {
  const n = cleanName(name); if (!n) throw Error("Name the group.");
  return { ...k, groups: k.groups.map(g => g.id === id ? { ...g, name: n } : g) };
};
export const deleteGroup = (k: PrepKnowledge, id: string): PrepKnowledge => ({ ...k, groups: k.groups.filter(g => g.id !== id) });
export function addToGroup(k: PrepKnowledge, id: string, item: GroupItem): PrepKnowledge {
  return { ...k, groups: k.groups.map(g => g.id === id ? { ...g, items: dedupeItems([...g.items, { ...item }]).slice(0, LIMITS.groupItems) } : g) };
}
export const removeFromGroup = (k: PrepKnowledge, id: string, identity: string): PrepKnowledge =>
  ({ ...k, groups: k.groups.map(g => g.id === id ? { ...g, items: g.items.filter(i => itemIdentity(i) !== identity) } : g) });
function dedupeItems<T extends GroupItem>(items: T[]): T[] {
  const seen = new Set<string>(); return items.filter(i => { const id = itemIdentity(i); if (seen.has(id)) return false; seen.add(id); return true; });
}

export function setFeedback(k: PrepKnowledge, artist: string, song: string, kind: Feedback["kind"] | null): PrepKnowledge {
  const key = songIdentity(artist, song), rest = k.feedback.filter(f => f.key !== key);
  return { ...k, feedback: kind ? [...rest, { key, label: `${artist} – ${song}`, kind, at: Date.now() }] : rest };
}

const eventOf = (k: PrepKnowledge, eventId: string): EventPrep => k.events.find(e => e.eventId === eventId) ?? { eventId, dismissed: [], shortlist: [] };
const withEvent = (k: PrepKnowledge, e: EventPrep): PrepKnowledge => ({ ...k, events: [...k.events.filter(x => x.eventId !== e.eventId), e] });
export const eventPrep = eventOf;
export function dismissForEvent(k: PrepKnowledge, eventId: string, artist: string, song: string): PrepKnowledge {
  const e = eventOf(k, eventId), key = songIdentity(artist, song);
  if (e.dismissed.some(d => d.key === key)) return k;
  return withEvent(k, { ...e, dismissed: [...e.dismissed, { key, label: `${artist} – ${song}`, at: Date.now() }] });
}
export const undoDismiss = (k: PrepKnowledge, eventId: string, key: string): PrepKnowledge => {
  const e = eventOf(k, eventId); return withEvent(k, { ...e, dismissed: e.dismissed.filter(d => d.key !== key) });
};

/** Add to shortlist; duplicates by exact identity are reported, not merged into another version. */
export function addShortlist(k: PrepKnowledge, eventId: string, item: { artist: string; song: string; versionNote?: string; trackId?: string; status?: ShortStatus }): { next: PrepKnowledge; added: boolean } {
  const e = eventOf(k, eventId);
  const candidate = { artist: item.artist.trim(), song: item.song.trim(), versionNote: (item.versionNote ?? "").trim(), trackId: item.trackId };
  if (!candidate.artist && !candidate.song) throw Error("Enter an artist or title.");
  if (e.shortlist.some(s => itemIdentity(s) === itemIdentity(candidate))) return { next: k, added: false };
  if (e.shortlist.length >= LIMITS.shortlist) throw Error("Shortlist limit reached.");
  const entry: ShortItem = { id: uid(), artist: candidate.artist, song: candidate.song, versionNote: candidate.versionNote, status: item.status ?? "considering", addedAt: Date.now(), ...(candidate.trackId ? { trackId: candidate.trackId } : {}) };
  return { next: withEvent(k, { ...e, shortlist: [...e.shortlist, entry] }), added: true };
}
export function updateShortlist(k: PrepKnowledge, eventId: string, id: string, patch: { status?: ShortStatus; versionNote?: string }): PrepKnowledge {
  const e = eventOf(k, eventId);
  return withEvent(k, { ...e, shortlist: e.shortlist.map(s => s.id === id ? { ...s, ...(patch.status ? { status: patch.status } : {}), ...(patch.versionNote !== undefined ? { versionNote: patch.versionNote.slice(0, 300) } : {}) } : s) });
}
/** File linkage only from an explicit identity resolution; refuses if another entry already owns that file. */
export function linkShortlistFile(k: PrepKnowledge, eventId: string, id: string, trackId: string | undefined): PrepKnowledge {
  const e = eventOf(k, eventId);
  if (trackId && e.shortlist.some(s => s.id !== id && s.trackId === trackId)) throw Error("That file is already linked to another shortlist entry.");
  return withEvent(k, { ...e, shortlist: e.shortlist.map(s => { if (s.id !== id) return s; const { trackId: _old, ...rest } = s; return trackId ? { ...rest, trackId } : rest; }) });
}
export const removeShortlist = (k: PrepKnowledge, eventId: string, id: string): PrepKnowledge => {
  const e = eventOf(k, eventId); return withEvent(k, { ...e, shortlist: e.shortlist.filter(s => s.id !== id) });
};
/** Copies a group's items into the event shortlist as "considering". The group itself is untouched. */
export function copyGroupToEvent(k: PrepKnowledge, groupId: string, eventId: string): { next: PrepKnowledge; added: number; skipped: number } {
  const g = k.groups.find(x => x.id === groupId); if (!g) throw Error("Group not found.");
  let next = k, added = 0, skipped = 0;
  for (const i of g.items) { const r = addShortlist(next, eventId, { ...i }); next = r.next; if (r.added) added++; else skipped++; }
  return { next, added, skipped };
}

export function saveEnrichment(k: PrepKnowledge, entry: Omit<Enrichment, "fetchedAt">): PrepKnowledge {
  const rest = k.enrichment.filter(e => !(e.key === entry.key && e.source === entry.source));
  return { ...k, enrichment: [...rest, { ...structuredClone(entry), fetchedAt: Date.now() }].slice(-LIMITS.enrichment) };
}
export const removeEnrichment = (k: PrepKnowledge, key: string, source: Enrichment["source"]): PrepKnowledge =>
  ({ ...k, enrichment: k.enrichment.filter(e => !(e.key === key && e.source === source)) });

/** Additive restore: existing entries always win; only missing ids/keys are added. */
export function mergeKnowledgeAdditive(current: PrepKnowledge, incoming: PrepKnowledge): { next: PrepKnowledge; added: number } {
  let added = 0;
  const add = <T,>(cur: T[], inc: T[], id: (x: T) => string) => { const have = new Set(cur.map(id)); const extra = inc.filter(x => !have.has(id(x))); added += extra.length; return [...cur, ...structuredClone(extra)]; };
  const events = current.events.map(e => ({ ...e }));
  for (const ie of incoming.events) {
    const ce = events.find(e => e.eventId === ie.eventId);
    if (!ce) { events.push(structuredClone(ie)); added += ie.dismissed.length + ie.shortlist.length; continue; }
    ce.dismissed = add(ce.dismissed, ie.dismissed, d => d.key);
    ce.shortlist = add(ce.shortlist, ie.shortlist, s => itemIdentity(s));
  }
  const next: PrepKnowledge = {
    version: 1, presets: add(current.presets, incoming.presets, p => p.id), tracks: add(current.tracks, incoming.tracks, t => t.id),
    groups: add(current.groups, incoming.groups, g => g.id), feedback: add(current.feedback, incoming.feedback, f => f.key),
    events, enrichment: add(current.enrichment, incoming.enrichment, e => `${e.source}:${e.key}`),
  };
  return { next, added };
}
