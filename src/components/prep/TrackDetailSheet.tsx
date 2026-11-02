import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Play, Search, Star, Ban, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cleanBpm, getFolderRoots, type SongMatch, type VdjTrack } from "@/lib/virtualDj";
import { trackIdentity } from "@/lib/fileIdentity";
import { fmtDur, trackFacts } from "@/lib/prep/filters";
import { addToGroup, createGroup, removeEnrichment, saveEnrichment, setFeedback, setTrackNote, songIdentity, normTags } from "@/lib/prep/knowledge";
import { compareCandidate, createLookupGuard } from "@/lib/prep/enrichment";
import { lookupLastfmTrack, lookupMusicBrainz, type LastfmTrackInfo, type MbCandidate } from "@/lib/prep/lookup.functions";
import type { Evidence } from "@/lib/prep/recommend";
import { prepStore } from "@/lib/prep/prepStore";
import { usePrep } from "./usePrep";

export interface DetailSubject {
  artist: string; song: string;
  /** The exact local file being shown (never swapped for another file). */
  track?: VdjTrack;
  /** Event context: current match and its alternative files, for side-by-side version comparison. */
  match?: SongMatch; alternatives?: VdjTrack[];
  evidence?: Evidence[]; origin?: string;
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function Field({ label, value, source }: { label: string; value?: string; source?: string }) {
  return <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd>{value ? <>{value}{source && <span className="ml-2 text-[11px] text-muted-foreground">({source})</span>}</> : <span className="text-muted-foreground">Unknown</span>}</dd>
  </div>;
}

export function TrackDetailSheet({ subject, onClose, onPreview }: { subject: DetailSubject | null; onClose: () => void; onPreview?: (t: VdjTrack) => void }) {
  const { state, knowledge, ready, mutate } = usePrep();
  const t = subject?.track;
  const id = useMemo(() => t ? trackIdentity(t.filePath, getFolderRoots()) : null, [t]);
  const sKey = subject ? songIdentity(subject.artist, subject.song) : "";
  const note = id ? knowledge.tracks.find(n => n.id === id) : undefined;
  const [noteText, setNoteText] = useState(""), [tagText, setTagText] = useState("");
  useEffect(() => { setNoteText(note?.note ?? ""); setTagText((note?.tags ?? []).join(", ")); }, [id, note?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const fb = knowledge.feedback.find(f => f.key === sKey);
  const saved = knowledge.enrichment.filter(e => e.key === sKey);
  const mbFn = useServerFn(lookupMusicBrainz), lfFn = useServerFn(lookupLastfmTrack);
  const guard = useRef(createLookupGuard());
  const [mb, setMb] = useState<{ busy: boolean; items?: MbCandidate[]; error?: string }>({ busy: false });
  const [lf, setLf] = useState<{ busy: boolean; info?: LastfmTrackInfo; error?: string }>({ busy: false });
  const [groupName, setGroupName] = useState("");
  // Reset lookups whenever the subject or account changes; late responses are ignored by the guard.
  useEffect(() => { guard.current.cancel(); setMb({ busy: false }); setLf({ busy: false }); }, [sKey, state.account]);
  useEffect(() => () => guard.current.cancel(), []);
  if (!subject) return null;
  const facts = t ? trackFacts(t) : undefined;
  const tagSrc = t?.fromTags ? "file tags" : "VirtualDJ";
  const runMb = async () => {
    const token = guard.current.begin(state.account, sKey); setMb({ busy: true });
    const r = await mbFn({ data: { artist: subject.artist, title: subject.song } }).catch(() => ({ ok: false as const, error: "Lookup failed.", retryable: true }));
    if (!guard.current.current(token, prepStoreAccount(), sKey)) return;
    setMb(r.ok ? { busy: false, items: r.items } : { busy: false, error: r.error });
  };
  const runLf = async () => {
    const token = guard.current.begin(state.account, sKey); setLf({ busy: true });
    const r = await lfFn({ data: { artist: subject.artist, title: subject.song } }).catch(() => ({ ok: false as const, error: "Lookup failed.", retryable: true }));
    if (!guard.current.current(token, prepStoreAccount(), sKey)) return;
    setLf(r.ok ? { busy: false, info: r.items } : { busy: false, error: r.error });
  };
  const versions = t ? [t, ...(subject.alternatives ?? []).filter(a => a.filePath !== t.filePath)] : subject.alternatives ?? [];
  return <Sheet open onOpenChange={o => { if (!o) onClose(); }}>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader>
        <SheetTitle className="pr-6">{subject.artist} – {subject.song}</SheetTitle>
        <SheetDescription>{t ? <>Exact file: <span className="break-all font-mono text-[11px]">{t.filePath}</span></> : "No local file is linked to this song."}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-5">
        {subject.match && <p className="rounded border border-border bg-muted/30 p-2 text-xs">
          Event status: <strong>{subject.match.confirmed ? "Confirmed recording" : subject.match.status}</strong>{!subject.match.confirmed && subject.match.trackIndex != null && " — not approved yet. Approve or change it in the event row; this panel never changes the chosen file."}
        </p>}
        {t && <section aria-label="Track facts">
          <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold">Facts</h3>{onPreview && <Button size="sm" variant="outline" onClick={() => onPreview(t)}><Play size={14} className="mr-1" />Preview waveform</Button>}</div>
          <dl>
            <Field label="BPM" value={cleanBpm(t.bpm) || undefined} source={tagSrc} />
            <Field label="Key" value={t.key} source={tagSrc} />
            <Field label="Length" value={facts?.durationSec ? fmtDur(facts.durationSec) : undefined} source="VirtualDJ" />
            <Field label="Year" value={t.year} source={tagSrc} />
            <Field label="Genre" value={t.genre} source={tagSrc} />
            <Field label="Remix/version" value={t.remix} source={tagSrc} />
            <Field label="Clean/explicit" value={facts?.clean} source={facts?.clean ? "guessed from file name — not verified" : undefined} />
            <Field label="Plays" value={t.playCount ? String(t.playCount) : undefined} source="your VirtualDJ history" />
          </dl>
        </section>}
        {versions.length > 1 && <section aria-label="Version comparison">
          <h3 className="mb-1 text-sm font-semibold">Versions in your library</h3>
          <p className="mb-2 text-xs text-muted-foreground">Different files are different recordings; remixes and clean edits are never merged.</p>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">File</th><th className="pr-2">Version</th><th className="pr-2">BPM</th><th className="pr-2">Length</th><th>Clean</th></tr></thead>
            <tbody>{versions.map((v, i) => { const f = trackFacts(v); return <tr key={v.filePath} className="border-t border-border align-top">
              <td className="break-all py-1 pr-2">{fileName(v.filePath)}{i === 0 && t && <span className="ml-1 rounded bg-primary/15 px-1 text-[10px] text-primary">shown</span>}</td>
              <td className="pr-2">{v.remix || "—"}</td><td className="pr-2">{cleanBpm(v.bpm) || "?"}</td><td className="pr-2">{f.durationSec ? fmtDur(f.durationSec) : "?"}</td><td>{f.clean ?? "?"}</td></tr>; })}</tbody></table></div>
        </section>}
        {subject.evidence && <section aria-label="Why recommended">
          <h3 className="mb-1 text-sm font-semibold">Why it's recommended</h3>
          {subject.evidence.length ? <ul className="space-y-0.5 text-xs">{subject.evidence.map((e, i) => <li key={i} className="flex justify-between gap-2"><span>{e.text}</span><span className="tabular-nums text-muted-foreground">{e.points > 0 ? "+" : ""}{e.points}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">No ranking evidence — it matches your filters but nothing specific points to it.</p>}
        </section>}
        <section aria-label="Your notes">
          <h3 className="mb-1 text-sm font-semibold">Your notes {!t && <span className="text-xs font-normal text-muted-foreground">(link a local file to keep per-file notes)</span>}</h3>
          {state.status === "blocked" && <p className="text-xs text-destructive">{state.error}</p>}
          {t && id && <div className="space-y-2">
            <Input aria-label="Tags, comma separated" placeholder="Tags, comma separated (e.g. first dance, singalong)" value={tagText} onChange={e => setTagText(e.target.value)} onBlur={() => { if (normTags(tagText.split(",")).join(",") !== (note?.tags ?? []).join(",")) void mutate(k => setTrackNote(k, id, { tags: tagText.split(",") })); }} disabled={!ready} />
            <Textarea aria-label="Personal note" placeholder="Personal note (stays in this app; never written into the music file)" value={noteText} onChange={e => setNoteText(e.target.value)} onBlur={() => { if (noteText !== (note?.note ?? "")) void mutate(k => setTrackNote(k, id, { note: noteText })); }} disabled={!ready} rows={3} />
          </div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant={fb?.kind === "favor" ? "default" : "outline"} disabled={!ready} aria-pressed={fb?.kind === "favor"} onClick={() => void mutate(k => setFeedback(k, subject.artist, subject.song, fb?.kind === "favor" ? null : "favor"))}><Star size={14} className="mr-1" />Favourite</Button>
            <Button size="sm" variant={fb?.kind === "never" ? "destructive" : "outline"} disabled={!ready} aria-pressed={fb?.kind === "never"} onClick={() => void mutate(k => setFeedback(k, subject.artist, subject.song, fb?.kind === "never" ? null : "never"))}><Ban size={14} className="mr-1" />{fb?.kind === "never" ? "Allow recommending again" : "Never recommend"}</Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Add to group" className="h-8 rounded-md border border-border bg-background px-2 text-xs" disabled={!ready} value="" onChange={e => { const g = e.target.value; if (g) void mutate(k => addToGroup(k, g, { artist: subject.artist, song: subject.song, ...(id ? { trackId: id } : {}) })); }}>
              <option value="">Add to group…</option>{knowledge.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Input className="h-8 w-36 text-xs" placeholder="New group name" aria-label="New group name" value={groupName} onChange={e => setGroupName(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!ready || !groupName.trim()} onClick={async () => { if (await mutate(k => createGroup(k, groupName, [{ artist: subject.artist, song: subject.song, ...(id ? { trackId: id } : {}) }]))) setGroupName(""); }}>Create group</Button>
          </div>
        </section>
        <section aria-label="Song information lookups">
          <h3 className="mb-1 text-sm font-semibold">Look up song information</h3>
          <p className="mb-2 text-xs text-muted-foreground">Results are suggestions for reference only. Nothing is written into your music files.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={mb.busy} onClick={runMb}>{mb.busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Search size={14} className="mr-1" />}MusicBrainz</Button>
            <Button size="sm" variant="outline" disabled={lf.busy} onClick={runLf}>{lf.busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Search size={14} className="mr-1" />}Last.fm tags & similar</Button>
          </div>
          {mb.error && <p role="alert" className="mt-2 text-xs text-destructive">{mb.error}</p>}
          {mb.items && (mb.items.length ? <ul className="mt-2 space-y-2">{mb.items.map(c => {
            const cmp = compareCandidate({ artist: subject.artist, title: subject.song, remix: t?.remix, durationSec: facts?.durationSec }, c);
            return <li key={c.id} className="rounded border border-border p-2 text-xs">
              <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{c.artist} – {c.title}{c.disambiguation && <span className="text-muted-foreground"> ({c.disambiguation})</span>}</p>
                <p className="text-muted-foreground">{[c.firstRelease, c.lengthSec ? fmtDur(c.lengthSec) : null, c.releases[0]].filter(Boolean).join(" · ")}</p>
                {c.tags.length > 0 && <p className="text-muted-foreground">Tags: {c.tags.join(", ")}</p>}</div>
                <span className="shrink-0 tabular-nums" title="How closely it matches this song">{cmp.confidence}% match</span></div>
              {cmp.warnings.map(w => <p key={w} className="text-[11px] text-destructive">⚠ {w}</p>)}
              <div className="mt-1 flex gap-2"><a className="inline-flex items-center gap-1 text-primary underline" href={c.url} target="_blank" rel="noopener noreferrer">MusicBrainz <ExternalLink size={11} /></a>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!ready} onClick={() => void mutate(k => saveEnrichment(k, { key: sKey, source: "musicbrainz", label: `${c.artist} – ${c.title}${c.disambiguation ? ` (${c.disambiguation})` : ""}`, url: c.url, data: { recordingId: c.id, ...(c.firstRelease ? { firstRelease: c.firstRelease } : {}), ...(c.lengthSec ? { lengthSec: c.lengthSec } : {}), tags: c.tags, isrcs: c.isrcs, confidence: cmp.confidence } }))}>Keep as reference</Button></div>
            </li>; })}</ul> : <p className="mt-2 text-xs text-muted-foreground">No MusicBrainz recordings found.</p>)}
          {lf.error && <p role="alert" className="mt-2 text-xs text-destructive">{lf.error}</p>}
          {lf.info && (!lf.info.available ? <p className="mt-2 text-xs text-muted-foreground">Last.fm isn't configured for this app.</p> : <div className="mt-2 space-y-1 text-xs">
            <p><span className="text-muted-foreground">Last.fm tags:</span> {lf.info.tags.join(", ") || "none"}</p>
            {lf.info.similar.length > 0 && <p><span className="text-muted-foreground">Similar tracks:</span> {lf.info.similar.slice(0, 8).map(s => `${s.artist} – ${s.title}`).join("; ")}</p>}
            <div className="flex gap-2">{lf.info.url && <a className="inline-flex items-center gap-1 text-primary underline" href={lf.info.url} target="_blank" rel="noopener noreferrer">Last.fm <ExternalLink size={11} /></a>}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!ready} onClick={() => void mutate(k => saveEnrichment(k, { key: sKey, source: "lastfm", label: `${subject.artist} – ${subject.song}`, ...(lf.info!.url ? { url: lf.info!.url } : {}), data: { tags: lf.info!.tags, similar: lf.info!.similar.slice(0, 15).map(s => `${s.artist} – ${s.title}`) } }))}>Keep as reference</Button></div>
          </div>)}
          {saved.length > 0 && <div className="mt-3 space-y-1"><p className="text-xs font-medium">Saved references</p>{saved.map(e => <div key={e.source} className="flex items-start justify-between gap-2 rounded border border-border p-2 text-xs">
            <div><p>{e.source === "musicbrainz" ? "MusicBrainz" : "Last.fm"}: {e.label}</p><p className="text-muted-foreground">Saved {new Date(e.fetchedAt).toLocaleDateString()}{Array.isArray(e.data.tags) && e.data.tags.length ? ` · ${(e.data.tags as string[]).join(", ")}` : ""}</p></div>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!ready} onClick={() => void mutate(k => removeEnrichment(k, sKey, e.source))}>Remove</Button></div>)}</div>}
          <p className="mt-2 text-[11px] text-muted-foreground">Audio fingerprint matching (AcoustID) isn't available: it needs fingerprint tooling in the Mac app.</p>
        </section>
      </div>
    </SheetContent>
  </Sheet>;
}

const prepStoreAccount = () => prepStore().get().account;
