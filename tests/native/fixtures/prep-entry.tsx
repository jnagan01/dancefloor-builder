// Bundled only by tests/native/prep.mjs. Real preparation components + real prep store (IndexedDB in a
// fenced synthetic Electron profile); every network/account service is a local stand-in.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Route as LibraryRoute } from '../../../src/routes/_authenticated/library';
import { EventPrepPanel, type PrepSectionKey } from '../../../src/components/prep/EventPrepPanel';
import { TrackDetailSheet, type DetailSubject } from '../../../src/components/prep/TrackDetailSheet';
import { WaveformPlayer } from '../../../src/components/workspace/WaveformPlayer';
import { AppearanceProvider } from '../../../src/components/AppearanceProvider';
import { prepStore } from '../../../src/lib/prep/prepStore';
import { emptyKnowledge } from '../../../src/lib/prep/knowledge';
import { planAddToSection } from '../../../src/lib/prep/addToSection';
import { validateBackup } from '../../../src/lib/backups';
import { buildLibrary, matchSong, parseVdjDatabaseXml, type SongMatch } from '../../../src/lib/virtualDj';
import { dedupeKey, type ResultSong } from '../../../src/lib/danceFloor';

const w = window as any;
w.__parseVdj = parseVdjDatabaseXml;
w.__prep = prepStore();
w.__switchAccount = async (account: string | null, force = false) => { const p = prepStore().setAccount(account, force); w.__setWorkspaceAccount(account); await p; };
type Lists = { warmUp: ResultSong[]; transition: ResultSong[]; peak: ResultSong[] };
const keyOf = (s: PrepSectionKey, i: number, song: { artist: string; song: string }) => `${s}:${i}:${dedupeKey(song.artist, song.song)}`;

function initialEvents(): Record<string, { result: Lists; matches: Record<string, SongMatch> }> {
  const e1: Lists = { warmUp: [{ artist: 'Queen', song: 'Song A', fromUpload: true }, { artist: 'Band', song: 'Hit' }, { artist: 'Ghost', song: 'Missing' }], transition: [{ artist: 'Other', song: 'Unknown' }], peak: [] };
  const e2: Lists = { warmUp: [{ artist: 'Queen', song: 'Song A', fromUpload: true }], transition: [], peak: [] };
  return {
    E1: { result: e1, matches: {
      [keyOf('warmUp', 0, e1.warmUp[0])]: { status: 'Matched', confidence: 1, trackIndex: 0, alternatives: [1], confirmed: true },
      [keyOf('warmUp', 1, e1.warmUp[1])]: { status: 'Multiple Matches', confidence: 0.7, trackIndex: 3, alternatives: [2] },
      [keyOf('transition', 0, e1.transition[0])]: { status: 'Matched', confidence: 1, trackIndex: 4, alternatives: [], confirmed: true, excludedFromVdj: true },
    } },
    E2: { result: e2, matches: { [keyOf('warmUp', 0, e2.warmUp[0])]: { status: 'Matched', confidence: 1, trackIndex: 1, alternatives: [0], confirmed: true } } },
  };
}

function EventHost() {
  const [events, setEvents] = React.useState(initialEvents);
  const [eventId, setEventId] = React.useState<'E1' | 'E2'>('E1');
  const [detail, setDetail] = React.useState<DetailSubject | null>(null);
  const [playing, setPlaying] = React.useState<any>(null);
  const library = React.useMemo(() => buildLibrary(w.__fixture.tracks), []);
  const ev = events[eventId];
  const sections = (['warmUp', 'transition', 'peak'] as PrepSectionKey[]).map(k => ({ key: k, label: k === 'warmUp' ? 'Warm Up' : k === 'transition' ? 'Transition' : 'Peak', songs: ev.result[k] }));
  return <div className="space-y-3 p-3">
    <div className="flex gap-2"><button className="border px-2" onClick={() => setEventId('E1')}>Open event E1</button><button className="border px-2" onClick={() => setEventId('E2')}>Open event E2</button><span data-testid="current-event">{eventId}</span></div>
    <EventPrepPanel key={eventId} eventId={eventId} sections={sections} matches={ev.matches} keyOf={keyOf} library={library}
      onJump={(s, i) => { w.__jumps = [...(w.__jumps ?? []), `${s}:${i}`]; document.getElementById(`song-${s}-${i}`)?.scrollIntoView(); }}
      onAddToSection={(section, song) => { const plan = planAddToSection(ev.result, section, song, library, {}, keyOf, matchSong); if ('error' in plan) return plan.error; setEvents(all => ({ ...all, [eventId]: { result: plan.result, matches: { ...all[eventId].matches, [plan.key]: plan.match } } })); return null; }}
      onDetails={setDetail} />
    <ol aria-label="Event rows">{sections.flatMap(s => s.songs.map((song, i) => { const m = ev.matches[keyOf(s.key, i, song)]; return <li key={`${s.key}-${i}`} id={`song-${s.key}-${i}`} data-testid="event-row">
      {s.label} #{i + 1}: {song.artist} – {song.song} · {m ? (m.confirmed ? 'approved' : `not approved (${m.status})`) : 'no match'}{m?.trackIndex != null ? ` · ${library.tracks[m.trackIndex]?.filePath}` : ''}
      <button className="ml-2 underline" onClick={() => setDetail({ artist: song.artist, song: song.song, match: m, track: m?.trackIndex != null ? library.tracks[m.trackIndex] : undefined, alternatives: (m?.alternatives ?? []).map(x => library.tracks[x]).filter(Boolean) })}>Row details {song.song}</button></li>; }))}</ol>
    <TrackDetailSheet subject={detail} onClose={() => setDetail(null)} onPreview={t => setPlaying({ artist: t.artist, song: t.title, filePath: t.filePath })} />
    <WaveformPlayer target={playing} resolve={() => undefined} onClose={() => setPlaying(null)} />
  </div>;
}

function BackupHost() {
  const [msg, setMsg] = React.useState('');
  const run = (f: () => Promise<string>) => f().then(setMsg, e => setMsg(`Error: ${e.message}`));
  return <div className="space-y-2 p-3">
    <button className="border px-2" onClick={() => run(async () => {
      const store = prepStore(), owner = store.owner()!; const prep = await store.backupSection(owner);
      const b = { format: 'setarchitect-backup', version: 1, account: owner.account, createdAt: new Date().toISOString(), events: [], sources: [], roots: {}, ...(prep ? { prep } : {}) };
      const raw = JSON.stringify(b); validateBackup(raw, owner.account); await w.prepNative.save(raw, owner.account);
      return `Backed up ${prep?.groups.length ?? 0} groups, ${prep?.tracks.length ?? 0} track notes`;
    })}>Back up preparation</button>
    <button className="border px-2" onClick={() => run(async () => { const s = prepStore(); await s.update(s.owner()!, () => emptyKnowledge()); return 'Wiped'; })}>Wipe preparation (test only)</button>
    <button className="border px-2" onClick={() => run(async () => {
      const s = prepStore(), owner = s.owner()!; const raw = await w.prepNative.latest(owner.account); const b = validateBackup(raw, owner.account);
      const n = await s.restoreAdditive(owner, b.prep); return `Restored ${n} items`;
    })}>Restore preparation from device backup</button>
    <p role="status" aria-label="Backup result">{msg}</p>
  </div>;
}

function Root() {
  const [page, setPage] = React.useState<'library' | 'event' | 'backup'>(w.__fixture.page ?? 'library');
  w.__goto = setPage;
  return <AppearanceProvider><nav className="flex gap-2 border-b p-2"><button onClick={() => setPage('library')}>Go library</button><button onClick={() => setPage('event')}>Go event</button><button onClick={() => setPage('backup')}>Go backup</button></nav>
    {page === 'library' ? <LibraryRoute.component /> : page === 'event' ? <EventHost /> : <BackupHost />}</AppearanceProvider>;
}
await w.__switchAccount(w.__fixture.account ?? 'synthetic-a');
createRoot(document.getElementById('root') as HTMLElement).render(<Root />);
