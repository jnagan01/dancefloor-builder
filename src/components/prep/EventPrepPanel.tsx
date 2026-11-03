import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Info, Plus, Undo2, Ban, X, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFolderRoots, type SongMatch, type VdjLibrary, type VdjTrack } from "@/lib/virtualDj";
import { trackIdentity } from "@/lib/fileIdentity";
import type { ResultSong } from "@/lib/danceFloor";
import { SONG_LIBRARY } from "@/lib/songLibrary";
import { getArtistCrowdData, getSimilarTracks } from "@/lib/lastfm.functions";
import { aggregateSimilar, availabilityNote, seedsFromRequests, type SimilarTrackEvidence } from "@/lib/prep/similarTracks";
import { libraryCandidate, requestFacts, selectedTrackIds } from "@/lib/prep/requestFacts";
import { EMPTY_FILTER, facetOptions, fmtDur, trackFacts, type FilterFacts, type FilterState } from "@/lib/prep/filters";
import { buildDashboard, type DrillItem } from "@/lib/prep/dashboard";
import { recommend, type Candidate, type RecControls, type SimilarArtistEvidence, type Recommendation } from "@/lib/prep/recommend";
import {
  addShortlist, copyGroupToEvent, createGroup, deleteGroup, dismissForEvent, eventPrep, itemIdentity, linkShortlistFile, removeFromGroup,
  removeShortlist, renameGroup, setEventTags, setFeedback, songIdentity, undoDismiss, updateShortlist, addToGroup, DISMISS_REASONS, type ShortStatus,
} from "@/lib/prep/knowledge";
import { FilterPanel } from "./FilterPanel";
import type { DetailSubject } from "./TrackDetailSheet";
import { usePrep } from "./usePrep";
import { buildResolver, cleanReason, requiresClean, seasonal, type PreparationInputs } from "@/lib/preparationPolicy";

export type PrepSectionKey = "warmUp" | "transition" | "peak";
export interface PrepSection { key: PrepSectionKey; label: string; songs: ResultSong[] }
interface Props {
  policies?: PreparationInputs;
  eventId: string | null;
  sections: PrepSection[];
  matches: Record<string, SongMatch>;
  keyOf: (section: PrepSectionKey, i: number, s: ResultSong) => string;
  library: VdjLibrary;
  onJump: (section: PrepSectionKey, index: number) => void;
  /** Uses the event's own add mutation; the new row is never auto-approved. Returns an error message or null. */
  onAddToSection: (section: PrepSectionKey, song: { artist: string; song: string; trackId?: string }) => string | null;
  onDetails: (s: DetailSubject) => void;
}

const STATUS_LABEL: Record<ShortStatus, string> = { considering: "Considering", selected: "Selected", obtain: "Need to obtain" };
const searchLinks = (artist: string, song: string, note: string) => {
  const q = encodeURIComponent([artist, song, note].filter(Boolean).join(" "));
  return [
    ["Beatport", `https://www.beatport.com/search?q=${q}`], ["Apple Music", `https://music.apple.com/us/search?term=${q}`],
    ["Amazon", `https://www.amazon.com/s?k=${q}&i=digital-music`], ["Bandcamp", `https://bandcamp.com/search?q=${q}`], ["YouTube", `https://www.youtube.com/results?search_query=${q}`],
  ] as const;
};

function Drill({ title, items, onJump, empty }: { title: string; items: DrillItem[]; onJump: Props["onJump"]; empty: string }) {
  const [open, setOpen] = useState(false);
  return <div className="rounded border border-border p-2">
    <button type="button" className="flex w-full items-center justify-between text-left text-sm" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={!items.length}>
      <span>{title}</span><span className={`tabular-nums ${items.length ? "font-semibold" : "text-muted-foreground"}`}>{items.length}</span>
    </button>
    {open && <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">{items.slice(0, 200).map(it => <li key={`${it.section}-${it.index}`}>
      <button type="button" className="w-full rounded px-1 text-left text-xs hover:bg-muted" onClick={() => onJump(it.section as PrepSectionKey, it.index)}>{it.label}{it.detail && <span className="text-muted-foreground"> — {it.detail}</span>}</button></li>)}</ul>}
    {!items.length && <p className="text-[11px] text-muted-foreground">{empty}</p>}
  </div>;
}

export function EventPrepPanel(p: Props) {
  const { state, knowledge, ready, mutate } = usePrep();
  // Live identity for async results: a response is applied only if account, session and event are unchanged.
  const live = useRef({ account: state.account, generation: state.generation, eventId: p.eventId });
  live.current = { account: state.account, generation: state.generation, eventId: p.eventId };
  const canEvent = ready && !!p.eventId;
  const ep = p.eventId ? eventPrep(knowledge, p.eventId) : { eventId: "", dismissed: [], shortlist: [], tags: [] as string[] };
  const eventTags = ep.tags ?? [];
  const allTags = useMemo(() => [...new Set(knowledge.tracks.flatMap(n => n.tags))].sort(), [knowledge.tracks]);
  const tracks = p.library.tracks;

  // ---- dashboard ----
  const dash = useMemo(() => buildDashboard(
    p.sections.map(s => ({ key: s.key, label: s.label, songs: s.songs })), p.matches,
    (sec, i, s) => p.keyOf(sec as PrepSectionKey, i, s as ResultSong),
    i => { const t = tracks[i]; if (!t) return undefined; const f = trackFacts(t); return { durationSec: f.durationSec, genre: f.genre, decade: f.decade, fileIdentity: trackIdentity(t.filePath, getFolderRoots()), cleanReason: cleanReason(t, requiresClean(p.policies)) }; },
  ), [p.sections, p.matches, p.keyOf, tracks, p.policies]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- recommendations ----
  const [controls, setControls] = useState<RecControls>({ familiarity: 0, clientSimilarity: 1, artistVariety: 0.5, ownedOnly: false });
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [similar, setSimilar] = useState<SimilarArtistEvidence[]>([]);
  const [simState, setSimState] = useState<{ busy: boolean; note?: string }>({ busy: false });
  const simGen = useRef(0);
  const [similarTracks, setSimilarTracks] = useState<SimilarTrackEvidence[]>([]);
  const [trackSimState, setTrackSimState] = useState<{ busy: boolean; note?: string }>({ busy: false });
  const trackSimGen = useRef(0);
  useEffect(() => { simGen.current++; trackSimGen.current++; setSimilar([]); setSimilarTracks([]); setSimState({ busy: false }); setTrackSimState({ busy: false }); return () => { simGen.current++; trackSimGen.current++; }; }, [state.account, state.generation, p.eventId]);
  const similarTracksFn = useServerFn(getSimilarTracks);
  const crowdFn = useServerFn(getArtistCrowdData);
  const ownedKeys = useMemo(() => new Set(tracks.map(t => songIdentity(t.artist, t.title))), [tracks]);
  const roots = useMemo(() => getFolderRoots(), [tracks]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolver = useMemo(() => buildResolver(tracks, p.policies), [tracks, p.policies]);
  const candidates = useMemo<Candidate[]>(() => {
    const lib: Candidate[] = tracks.filter(t => (p.policies?.includeSeasonalTracks !== false || !seasonal(t)) && !cleanReason(t, requiresClean(p.policies))).map(t => libraryCandidate(t, trackIdentity(t.filePath, roots)));
    const cat: Candidate[] = SONG_LIBRARY.map(s => {
      const owned = ownedKeys.has(songIdentity(s.artist, s.song));
      const facts: FilterFacts = { genre: s.genre || undefined, decade: s.decade || undefined, energy: s.energy, owned, genreSource: s.genre ? "catalogue" : undefined, decadeSource: s.decade ? "catalogue" : undefined };
      return { artist: s.artist, song: s.song, facts, origin: "catalogue" as const };
    }).filter(c => !c.facts.owned && resolver.allowed(c) && !requiresClean(p.policies)); // owned catalogue songs already appear as library files
    return [...lib, ...cat];
  }, [tracks, roots, ownedKeys, resolver, p.policies]);
  const recFacts = useMemo(() => candidates.map(c => c.facts), [candidates]);
  const recOptions = useMemo(() => facetOptions(recFacts), [recFacts]);
  const notesMap = useMemo(() => new Map(knowledge.tracks.map(n => [n.id, n])), [knowledge.tracks]);
  const inEvent = useMemo(() => p.sections.flatMap(s => s.songs), [p.sections]);
  // Files the event rows already point at (selected primary + explicit extras), by exact identity only.
  const inEventTrackIds = useMemo(() => selectedTrackIds(p.sections, p.matches, p.keyOf, tracks, roots),
    [p.sections, p.matches, p.keyOf, tracks, roots]); // eslint-disable-line react-hooks/exhaustive-deps
  const requests = useMemo(() => p.sections.flatMap(s => s.songs.map((song, i) => ({ song, i, s }))).filter(x => x.song.fromUpload).map(({ song, i, s }) => {
    return requestFacts(song, p.matches[p.keyOf(s.key, i, song)], tracks);
  }), [p.sections, p.matches, p.keyOf, tracks, p.policies]); // eslint-disable-line react-hooks/exhaustive-deps
  const rec = useMemo(() => recommend({ candidates, requests, inEvent, inEventTrackIds, feedback: knowledge.feedback, dismissed: ep.dismissed, notes: notesMap, eventTags, similar, similarTracks, controls, filter, limit: 40 }),
    [candidates, requests, inEvent, inEventTrackIds, knowledge.feedback, ep.dismissed, notesMap, eventTags, similar, similarTracks, controls, filter]);
  const loadSimilar = async () => {
    const artists = [...new Set(requests.map(r => r.artist).filter(Boolean))].slice(0, 20);
    if (!artists.length) { setSimState({ busy: false, note: "No client requests to compare with yet." }); return; }
    const gen = ++simGen.current, started = { ...live.current };
    const stillCurrent = () => gen === simGen.current && live.current.account === started.account && live.current.generation === started.generation && live.current.eventId === started.eventId;
    setSimState({ busy: true });
    try {
      const r = await crowdFn({ data: { artists } });
      if (!stillCurrent()) return;
      if (!r.available) { setSimState({ busy: false, note: "Last.fm isn't configured for this app." }); return; }
      setSimilar(r.artists.flatMap(a => a.similar.map(s => ({ artist: s.name, similarTo: a.name, match: s.match }))));
      setSimState({ busy: false, note: `Using Last.fm similar artists for ${r.artists.length} requested artist${r.artists.length === 1 ? "" : "s"}.` });
    } catch { if (stillCurrent()) setSimState({ busy: false, note: "Couldn't reach Last.fm. Recommendations work without it." }); }
  };

  const loadSimilarTracks = async () => {
    // Only bounded artist/title seeds from distinct client requests are sent; nothing else about the event or library.
    const seeds = seedsFromRequests(requests);
    if (!seeds.length) { setTrackSimState({ busy: false, note: availabilityNote("noSeeds", 0) }); return; }
    const gen = ++trackSimGen.current, started = { ...live.current };
    const stillCurrent = () => gen === trackSimGen.current && live.current.account === started.account && live.current.generation === started.generation && live.current.eventId === started.eventId;
    setTrackSimState({ busy: true });
    try {
      const r = await similarTracksFn({ data: { seeds, perSeed: 20 } });
      if (!stillCurrent()) return;
      setSimilarTracks(aggregateSimilar(r.seeds));
      setTrackSimState({ busy: false, note: availabilityNote(r.availability, seeds.length) });
    } catch { if (stillCurrent()) setTrackSimState({ busy: false, note: availabilityNote("unavailable", seeds.length) }); }
  };

  // ---- shortlist ----
  const [draft, setDraft] = useState({ artist: "", song: "", versionNote: "" });
  const [adding, setAdding] = useState(false);
  const [targetSection, setTargetSection] = useState<PrepSectionKey>(p.sections[0]?.key ?? "warmUp");
  const [linking, setLinking] = useState<string | null>(null), [linkQuery, setLinkQuery] = useState("");
  const linkResults = useMemo(() => {
    const q = linkQuery.trim().toLowerCase(); if (q.length < 2) return [] as VdjTrack[];
    const out: VdjTrack[] = []; for (const t of tracks) { if (`${t.artist} ${t.title} ${t.filePath}`.toLowerCase().includes(q)) { out.push(t); if (out.length >= 20) break; } } return out;
  }, [linkQuery, tracks]);
  const trackById = useMemo(() => new Map(tracks.map(t => [trackIdentity(t.filePath, roots), t])), [tracks, roots]);
  const addRec = async (r: Recommendation) => { if (!p.eventId) return; const ev = p.eventId; const res = await mutate(k => addShortlist(k, ev, { artist: r.artist, song: r.song, trackId: r.trackId }).next); return res; };

  // ---- groups ----
  const [groupName, setGroupName] = useState("");
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; name: string } | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const ns = <p className="rounded border border-border bg-muted/30 p-2 text-xs">Save this event first to keep a shortlist and event dismissals.</p>;
  return <section aria-label="Event preparation" className="min-w-0 max-w-full space-y-3 overflow-hidden border border-border bg-card p-3">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Preparation</h2>
      {state.status === "blocked" && <span className="text-xs text-destructive">{state.error}</span>}</div>
    <Tabs defaultValue="overview">
      <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="recs">Recommendations</TabsTrigger><TabsTrigger value="shortlist">Shortlist ({ep.shortlist.length})</TabsTrigger><TabsTrigger value="groups">Groups ({knowledge.groups.length})</TabsTrigger></TabsList>

      <TabsContent value="overview" className="space-y-3">
        <p className="text-xs text-muted-foreground">{dash.totals.songs} track rows · {dash.totals.confirmed} unique eligible tracks · approved length {fmtDur(dash.totals.knownSec)}. Repeated files do not add coverage. File presence on disk is checked by "Check export readiness".</p>
        <div className="grid gap-2 md:grid-cols-2">
          <Drill title="Waiting for your approval" items={dash.sections.flatMap(s => s.pending)} onJump={p.onJump} empty="Every linked track is approved." />
          <Drill title="No track linked" items={dash.sections.flatMap(s => s.notLinked)} onJump={p.onJump} empty="Every song has a linked track." />
          <Drill title="Linked track missing from library" items={dash.sections.flatMap(s => s.linkedMissing)} onJump={p.onJump} empty="Every linked track is still in your library index." />
          <Drill title="Excluded from DJ export" items={dash.sections.flatMap(s => s.excluded)} onJump={p.onJump} empty="No songs are excluded." />
          <Drill title="Alternate versions to compare" items={dash.sections.flatMap(s => s.alternates)} onJump={p.onJump} empty="No unapproved songs with several candidate tracks." />
          <Drill title="Unknown length" items={dash.sections.flatMap(s => s.unknownDuration)} onJump={p.onJump} empty="Every approved track has a known length." />
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Section</th><th>Songs</th><th>Confirmed</th><th>Approved length</th><th>Estimated total</th></tr></thead>
          <tbody>{dash.sections.map(s => <tr key={s.key} className="border-t border-border align-top"><td className="py-1">{s.label}</td><td>{s.count}</td><td>{s.confirmed}</td><td>{fmtDur(s.knownSec)}{s.unknownDuration.length ? ` + ${s.unknownDuration.length} unknown` : ""}</td>
            <td>{s.estimatedSec != null ? <>{s.estimateBasis ? "≈ " : ""}{fmtDur(s.estimatedSec)}{s.estimateBasis && <span className="block text-[11px] text-muted-foreground">{s.estimateBasis}</span>}</> : "—"}</td></tr>)}</tbody></table></div>
        <div className="grid gap-3 md:grid-cols-3 text-xs">
          <div><p className="font-medium">Artists repeated</p>{dash.artistRepeats.length ? <ul>{dash.artistRepeats.slice(0, 10).map(a => <li key={a.artist}><button type="button" className="hover:underline" onClick={() => p.onJump(a.where[0].section as PrepSectionKey, a.where[0].index)}>{a.artist} × {a.count}</button></li>)}</ul> : <p className="text-muted-foreground">No repeats.</p>}</div>
          <div><p className="font-medium">Genres</p><ul>{dash.genres.map(g => <li key={g.label}>{g.label} · {g.count}</li>)}</ul>{dash.unknownGenre > 0 && <p className="text-muted-foreground">{dash.unknownGenre} unknown</p>}{dash.tentativeGenre > 0 && <p className="text-muted-foreground">{dash.tentativeGenre} from event details (tentative, not track tags)</p>}</div>
          <div><p className="font-medium">Decades</p><ul>{dash.decades.map(d => <li key={d.label}>{d.label} · {d.count}</li>)}</ul>{dash.unknownDecade > 0 && <p className="text-muted-foreground">{dash.unknownDecade} unknown</p>}{dash.tentativeDecade > 0 && <p className="text-muted-foreground">{dash.tentativeDecade} from event details (tentative, not track tags)</p>}</div>
        </div>
      </TabsContent>

      <TabsContent value="recs" className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs"><span className="flex justify-between"><span>Discovery</span><span>Familiar</span></span>
            <Slider aria-label="Discovery to familiar" min={-1} max={1} step={0.25} value={[controls.familiarity]} onValueChange={([v]) => setControls(c => ({ ...c, familiarity: v }))} />
            <span className="text-[11px] text-muted-foreground">Uses only your own VirtualDJ play counts — not crowd data.</span></label>
          <label className="space-y-1 text-xs"><span>Similarity to client requests</span><Slider aria-label="Similarity to client requests" min={0} max={1} step={0.1} value={[controls.clientSimilarity]} onValueChange={([v]) => setControls(c => ({ ...c, clientSimilarity: v }))} /></label>
          <label className="space-y-1 text-xs"><span>Artist variety</span><Slider aria-label="Artist variety" min={0} max={1} step={0.1} value={[controls.artistVariety]} onValueChange={([v]) => setControls(c => ({ ...c, artistVariety: v }))} /></label>
          <label className="flex items-center gap-2 text-xs"><Switch checked={controls.ownedOnly} onCheckedChange={v => setControls(c => ({ ...c, ownedOnly: v }))} aria-label="Only songs I own" />Only songs I own</label>
        </div>
        <fieldset className="space-y-1 text-xs"><legend className="font-medium">Your tags to favour for this event</legend>
          {allTags.length ? <div className="flex flex-wrap gap-1">{allTags.map(t => { const on = eventTags.includes(t); return <Button key={t} size="sm" variant={on ? "default" : "outline"} className="h-7 px-2 text-xs" aria-pressed={on} disabled={!canEvent} onClick={() => void mutate(k => setEventTags(k, p.eventId!, on ? eventTags.filter(x => x !== t) : [...eventTags, t]))}>{t}</Button>; })}</div>
            : <p className="text-muted-foreground">Tag tracks in their details (e.g. "first dance", "singalong") to use them here.</p>}
          {!p.eventId && allTags.length > 0 && <p className="text-muted-foreground">Save the event to choose tags for it.</p>}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={simState.busy} onClick={loadSimilar}>{simState.busy && <Loader2 size={14} className="mr-1 animate-spin" />}Add Last.fm similar artists</Button>{simState.note && <span className="text-xs text-muted-foreground">{simState.note}</span>}
          <Button size="sm" variant="outline" disabled={trackSimState.busy} onClick={loadSimilarTracks}>{trackSimState.busy && <Loader2 size={14} className="mr-1 animate-spin" />}Add Last.fm similar tracks</Button>{trackSimState.note && <span className="text-xs text-muted-foreground" data-testid="lastfm-track-note">{trackSimState.note}</span>}</div>
        <FilterPanel context="recommendation" options={recOptions} value={filter} onChange={setFilter} shown={rec.items.length} />
        <p className="text-xs text-muted-foreground">Client requests always stay in the event. Hidden: {rec.hidden.inEvent} already in event, {rec.hidden.dismissed} dismissed here, {rec.hidden.never} never recommend, {rec.hidden.filtered} filtered{controls.ownedOnly ? `, ${rec.hidden.notOwned} not owned` : ""}.</p>
        <ul className="space-y-1.5">{rec.items.map(r => <li key={`${r.key}|${r.trackId ?? ""}`} className="rounded border border-border p-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-sm font-medium">{r.artist} – {r.song} <span className={`ml-1 rounded px-1 text-[10px] ${r.origin === "library" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{r.origin === "library" ? "Your file" : "Not owned"}</span></p>
              <ul className="text-[11px] text-muted-foreground">{r.evidence.length ? r.evidence.map((e, i) => <li key={i}>{e.points > 0 ? "+" : ""}{e.points} · {e.text}</li>) : <li>No specific evidence; shown because it passes your filters.</li>}</ul></div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" aria-label={`Details for ${r.artist} – ${r.song}`} onClick={() => p.onDetails({ artist: r.artist, song: r.song, track: r.trackId ? trackById.get(r.trackId) : undefined, evidence: r.evidence, origin: r.origin })}><Info size={14} /></Button>
              <Button size="sm" variant="outline" disabled={!canEvent || ep.shortlist.some(s => itemIdentity(s) === itemIdentity({ artist: r.artist, song: r.song, trackId: r.trackId }))} onClick={() => void addRec(r)}><Plus size={14} className="mr-1" />Shortlist</Button>
              <Button size="sm" variant="ghost" disabled={!canEvent} onClick={() => p.eventId && void mutate(k => dismissForEvent(k, p.eventId!, r.artist, r.song))}>Dismiss here</Button>
              {DISMISS_REASONS.map(reason => <Button key={reason.value} size="sm" variant="ghost" disabled={!canEvent} aria-label={`Dismiss ${r.artist} – ${r.song} here: ${reason.label}`} onClick={() => p.eventId && void mutate(k => dismissForEvent(k, p.eventId!, r.artist, r.song, reason.value))}>{reason.label}</Button>)}
              <Button size="sm" variant="ghost" disabled={!ready} onClick={() => void mutate(k => setFeedback(k, r.artist, r.song, "never"))}><Ban size={14} className="mr-1" />Never</Button>
            </div></div></li>)}</ul>
        {(ep.dismissed.length > 0 || knowledge.feedback.some(f => f.kind === "never")) && <details className="text-xs"><summary className="cursor-pointer">Manage hidden songs</summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div><p className="font-medium">Dismissed for this event</p>{ep.dismissed.map(d => <p key={d.key} className="flex items-center justify-between">{d.label}{d.reason ? ` · ${DISMISS_REASONS.find(x => x.value === d.reason)?.label}` : ""}<Button size="sm" variant="ghost" className="h-6" onClick={() => void mutate(k => undoDismiss(k, p.eventId!, d.key))}><Undo2 size={12} className="mr-1" />Undo</Button></p>)}</div>
            <div><p className="font-medium">Never recommend (all events)</p>{knowledge.feedback.filter(f => f.kind === "never").map(f => { return <p key={f.key} className="flex items-center justify-between">{f.label}<Button size="sm" variant="ghost" className="h-6" onClick={() => void mutate(k => ({ ...k, feedback: k.feedback.filter(x => x.key !== f.key) }))}><Undo2 size={12} className="mr-1" />Allow</Button></p>; })}</div>
          </div></details>}
      </TabsContent>

      <TabsContent value="shortlist" className="space-y-3">
        {!p.eventId ? ns : <>
          <form className="flex flex-wrap gap-2" onSubmit={async e => {
            e.preventDefault(); if (adding) return;
            const ev = p.eventId!, submitted = draft; let dup = false;
            setAdding(true); setCopyNote(null);
            try {
              const ok = await mutate(k => { const r = addShortlist(k, ev, submitted); dup = !r.added; return r.next; });
              // Clear only what was submitted; anything typed while saving is kept.
              if (ok && !dup) setDraft(d => d.artist === submitted.artist && d.song === submitted.song && d.versionNote === submitted.versionNote ? { artist: "", song: "", versionNote: "" } : d);
              if (dup) setCopyNote("Already on the shortlist (same song and version note).");
            } finally { setAdding(false); }
          }}>
            <Input className="h-8 w-40 text-xs" placeholder="Artist" aria-label="Shortlist artist" value={draft.artist} onChange={e => setDraft(d => ({ ...d, artist: e.target.value }))} />
            <Input className="h-8 w-48 text-xs" placeholder="Title" aria-label="Shortlist title" value={draft.song} onChange={e => setDraft(d => ({ ...d, song: e.target.value }))} />
            <Input className="h-8 w-48 text-xs" placeholder="Desired version (e.g. clean radio edit)" aria-label="Desired version" value={draft.versionNote} onChange={e => setDraft(d => ({ ...d, versionNote: e.target.value }))} />
            <Button size="sm" type="submit" disabled={adding || !canEvent || !(draft.artist.trim() || draft.song.trim())}>{adding ? "Adding…" : "Add"}</Button>
          </form>
          {copyNote && <p className="text-xs text-muted-foreground" role="status">{copyNote}</p>}
          <div className="flex items-center gap-2 text-xs"><span>Add to section:</span><select aria-label="Section to add shortlist songs to" className="h-8 rounded-md border border-border bg-background px-2" value={targetSection} onChange={e => setTargetSection(e.target.value as PrepSectionKey)}>{p.sections.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            <span className="text-muted-foreground">Added songs still need their track approved in the event.</span></div>
          {knowledge.groups.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs"><span>Copy a saved group into this shortlist:</span>
            <select aria-label="Copy group into shortlist" className="h-8 rounded-md border border-border bg-background px-2" value="" disabled={!canEvent} onChange={async e => { const gid = e.target.value; if (!gid) return; let n = { added: 0, skipped: 0 }; const ok = await mutate(k => { const r = copyGroupToEvent(k, gid, p.eventId!); n = r; return r.next; }); if (ok) setCopyNote(`Copied ${n.added} song${n.added === 1 ? "" : "s"} to the shortlist${n.skipped ? `, ${n.skipped} already there` : ""}.`); }}>
              <option value="">Choose group…</option>{knowledge.groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.items.length})</option>)}</select></div>}
          {!ep.shortlist.length && <p className="text-xs text-muted-foreground">Nothing shortlisted yet. Add songs here or from Recommendations.</p>}
          <ul className="space-y-1.5">{ep.shortlist.map(s => { const linked = s.trackId ? trackById.get(s.trackId) : undefined; return <li key={s.id} className="rounded border border-border p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{s.artist} – {s.song}</p>
              <div className="flex flex-wrap items-center gap-1">
                <select aria-label={`Status for ${s.artist} – ${s.song}`} className="h-7 rounded border border-border bg-background px-1" value={s.status} onChange={e => { const status = e.target.value as ShortStatus; void mutate(k => updateShortlist(k, p.eventId!, s.id, { status })); }}>{(Object.keys(STATUS_LABEL) as ShortStatus[]).map(v => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}</select>
                <Button size="sm" variant="outline" className="h-7" onClick={() => { const err = p.onAddToSection(targetSection, { artist: s.artist, song: s.song, trackId: s.trackId }); setCopyNote(err ?? `Added to ${p.sections.find(x => x.key === targetSection)?.label}. Approve its track in the event.`); }}>Add to section</Button>
                {knowledge.groups.length > 0 && <select aria-label={`Save ${s.artist} – ${s.song} to group`} className="h-7 rounded border border-border bg-background px-1" value="" onChange={e => { const gid = e.target.value; if (gid) void mutate(k => addToGroup(k, gid, { artist: s.artist, song: s.song, ...(s.versionNote ? { versionNote: s.versionNote } : {}), ...(s.trackId ? { trackId: s.trackId } : {}) })); }}><option value="">Save to group…</option>{knowledge.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
                <Button size="sm" variant="ghost" className="h-7" aria-label="Details" onClick={() => p.onDetails({ artist: s.artist, song: s.song, track: linked })}><Info size={14} /></Button>
                <Button size="sm" variant="ghost" className="h-7" aria-label={`Remove ${s.artist} – ${s.song} from shortlist`} onClick={() => void mutate(k => removeShortlist(k, p.eventId!, s.id))}><X size={14} /></Button>
              </div></div>
            <Input key={`${s.id}:${s.versionNote}`} className="mt-1 h-7 text-xs" aria-label={`Desired version note for ${s.artist} – ${s.song}`} placeholder="Desired version note" defaultValue={s.versionNote} onBlur={e => { const versionNote = e.target.value; if (versionNote !== s.versionNote) void mutate(k => updateShortlist(k, p.eventId!, s.id, { versionNote })); }} />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {linked ? <span>Linked file: <span className="font-mono">{linked.filePath.split(/[\\/]/).pop()}</span> <button type="button" className="underline" onClick={() => void mutate(k => linkShortlistFile(k, p.eventId!, s.id, undefined))}>Unlink</button></span>
                : s.trackId ? <span className="text-warning">Linked file isn't in the current library</span>
                : <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => { setLinking(s.id); setLinkQuery(`${s.artist} ${s.song}`.trim()); }}><Link2 size={12} />Link a local file…</button>}
              {searchLinks(s.artist, s.song, s.versionNote).map(([n, u]) => <a key={n} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline">{n}<ExternalLink size={10} /></a>)}
            </div>
            {linking === s.id && <div className="mt-2 rounded border border-border p-2">
              <div className="flex gap-2"><Input className="h-7 text-xs" aria-label="Search your library to link a file" value={linkQuery} onChange={e => setLinkQuery(e.target.value)} autoFocus /><Button size="sm" variant="ghost" className="h-7" onClick={() => setLinking(null)}>Cancel</Button></div>
              <ul className="mt-1 max-h-40 overflow-auto">{linkResults.map(t => <li key={t.filePath}><button type="button" className="w-full rounded px-1 text-left hover:bg-muted" onClick={async () => { const id = trackIdentity(t.filePath, roots); if (await mutate(k => linkShortlistFile(k, p.eventId!, s.id, id))) setLinking(null); }}>{t.artist} – {t.title}{t.remix ? ` (${t.remix})` : ""} <span className="text-muted-foreground">{t.filePath.split(/[\\/]/).pop()}</span></button></li>)}</ul>
              <p className="mt-1 text-[11px] text-muted-foreground">Pick the exact file you obtained. Showing up to 20 results.</p></div>}
          </li>; })}</ul>
        </>}
      </TabsContent>

      <TabsContent value="groups" className="space-y-3">
        <div className="flex gap-2"><Input className="h-8 w-56 text-xs" placeholder="New group (e.g. Wedding singalongs)" aria-label="New group name" value={groupName} onChange={e => setGroupName(e.target.value)} />
          <Button size="sm" disabled={!ready || !groupName.trim()} onClick={async () => { if (await mutate(k => createGroup(k, groupName))) setGroupName(""); }}>Create</Button></div>
        <p className="text-xs text-muted-foreground">Groups belong to your account and are reusable. Copying a group into this event's shortlist leaves the group unchanged. Add songs to groups from any song's details.</p>
        {knowledge.groups.map(g => <details key={g.id} open={renamingGroup?.id === g.id ? true : undefined} className="rounded border border-border p-2 text-xs">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{g.name} ({g.items.length})</span>
            <span className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7" disabled={!canEvent || !g.items.length} onClick={async e => { e.preventDefault(); let n = { added: 0, skipped: 0 }; const ok = await mutate(k => { const r = copyGroupToEvent(k, g.id, p.eventId!); n = r; return r.next; }); if (ok) setCopyNote(`Copied ${n.added} song${n.added === 1 ? "" : "s"} to the shortlist${n.skipped ? `, ${n.skipped} already there` : ""}.`); }}>Copy to shortlist</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={e => { e.preventDefault(); setRenamingGroup({ id: g.id, name: g.name }); }}>Rename</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={e => { e.preventDefault(); if (window.confirm(`Delete group “${g.name}”? Events already copied from it keep their songs.`)) void mutate(k => deleteGroup(k, g.id)); }}>Delete</Button>
            </span></summary>
          {renamingGroup?.id === g.id && <form className="mt-1 flex flex-wrap gap-1" onSubmit={async e => { e.preventDefault(); if (await mutate(k => renameGroup(k, g.id, renamingGroup.name))) setRenamingGroup(null); }}>
            <Input className="h-7 w-48 text-xs" aria-label={`New name for ${g.name}`} value={renamingGroup.name} autoFocus onChange={e => setRenamingGroup({ id: g.id, name: e.target.value })} />
            <Button size="sm" type="submit" className="h-7" disabled={!renamingGroup.name.trim()}>Save name</Button><Button size="sm" type="button" variant="ghost" className="h-7" onClick={() => setRenamingGroup(null)}>Cancel</Button></form>}
          <ul className="mt-1">{g.items.map(i => <li key={itemIdentity(i)} className="flex items-center justify-between"><span>{i.artist} – {i.song}{i.versionNote ? ` (${i.versionNote})` : ""}{i.trackId ? " · linked file" : ""}</span>
            <Button size="sm" variant="ghost" className="h-6" aria-label={`Remove ${i.artist} – ${i.song} from group`} onClick={() => void mutate(k => removeFromGroup(k, g.id, itemIdentity(i)))}><X size={12} /></Button></li>)}</ul>
        </details>)}
        {copyNote && <p className="text-xs text-muted-foreground" role="status">{copyNote}</p>}
      </TabsContent>
    </Tabs>
  </section>;
}
