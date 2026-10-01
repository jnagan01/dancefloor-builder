import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, Library, Music2, ArrowRight, Play, TrendingUp, Check, AlertCircle, Flame } from "lucide-react";
import { listWorkflows, listMostRequested } from "@/lib/history.functions";
import { getTrendingCharts, DJ_GENRES, type ChartEntry, type ChartSource, type ConsensusTrack, type ConsensusArtist, type DjGenre } from "@/lib/charts.functions";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WaveformPlayer } from "@/components/workspace/WaveformPlayer";
import type { PreviewTarget } from "@/components/PreviewPlayer";
import { pageHead } from "@/lib/pageHead";

/** Small round play button shown over artwork and on list rows. */
function PlayButton({ onClick, label, className = "" }: { onClick: () => void; label: string; className?: string }) {
  return <button type="button" aria-label={`Play ${label}`} title={`Play ${label}`} onClick={onClick}
    className={`grid size-7 shrink-0 place-items-center rounded-full bg-primary/90 text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${className}`}>
    <Play size={13} className="translate-x-px"/>
  </button>;
}


export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
  head: () => pageHead("Home", "Trending charts, your most played tracks and most requested songs in one place."),
});

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\(.*?\)|\[.*?\]/g, "").replace(/feat\.?.*$/, "").replace(/[^a-z0-9]+/g, " ").trim();

const DANCE_WORDS = ["dance", "pop", "hip-hop", "hip hop", "rap", "house", "electronic", "r&b", "soul", "latin", "reggae", "funk", "disco", "edm"];
const isDanceable = (e: { genre?: string }) => !e.genre || DANCE_WORDS.some(w => e.genre!.toLowerCase().includes(w));

const SOURCE_LABEL: Record<ChartSource, string> = { apple: "Apple", billboard: "Billboard", lastfm: "Last.fm", shazam: "Shazam" };
const compact = (n?: number) => (n ? Intl.NumberFormat("en", { notation: "compact" }).format(n) : undefined);


function HomePage() {
  const { library, sources, files, loading } = useWorkspace();
  const list = useServerFn(listWorkflows);
  const charts = useServerFn(getTrendingCharts);
  const requested = useServerFn(listMostRequested);

  const { data: events = [] } = useQuery({ queryKey: ["workflowHistory"], queryFn: () => list() });
  const { data: chartData, isLoading: chartsLoading } = useQuery({
    queryKey: ["trendingCharts"],
    queryFn: () => charts(),
    staleTime: 30 * 60 * 1000,
  });
  const { data: mostRequested = [] } = useQuery({ queryKey: ["mostRequested"], queryFn: () => requested() });

  const [djOnly, setDjOnly] = useState(false);
  const [platform, setPlatform] = useState("all");
  const [playing, setPlaying] = useState<PreviewTarget | null>(null);

  /** Finds a connected local file so charts play the real song when owned. */
  const resolveFile = (q: { artist?: string; title?: string; filePath?: string }) => {
    if (q.filePath) {
      const direct = files.find(f => (f.webkitRelativePath || f.name) === q.filePath || f.name === q.filePath!.split("/").pop());
      if (direct) return direct;
    }
    if (!q.title) return undefined;
    const want = norm(q.title);
    const artist = q.artist ? norm(q.artist) : "";
    return files.find(f => {
      const name = norm(f.name.replace(/\.[a-z0-9]+$/i, ""));
      return name.includes(want) && (!artist || name.includes(artist));
    });
  };
  const play = (artist: string, song: string, filePath?: string) => setPlaying({ artist, song, filePath });



  const libraryKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of sources) for (const t of s.tracks) {
      if (t.title) set.add(`${norm(t.artist ?? "")}|${norm(t.title)}`);
      if (t.title) set.add(norm(t.title));
    }
    return set;
  }, [sources]);

  const inLibrary = (e: { artist: string; title: string }) =>
    libraryKeys.has(`${norm(e.artist)}|${norm(e.title)}`) || libraryKeys.has(norm(e.title));


  const eventSongs = events.reduce((n, e) => n + e.counts.warmUp + e.counts.transition + e.counts.peak, 0);
  const topPlayed = sources.flatMap(s => s.tracks).filter(t => (t.playCount ?? 0) > 0)
    .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 8);

  const platforms = [
    { id: "all", label: "All platforms" },
    { id: "apple", label: "Apple Music" },
    { id: "billboard", label: "Billboard" },
    { id: "lastfm", label: "Last.fm" },
    { id: "shazam", label: "Shazam" },
  ] as const;

  const perPlatform: Record<string, ChartEntry[]> = {
    apple: chartData?.apple ?? [],
    billboard: chartData?.billboard ?? [],
    lastfm: chartData?.lastfm ?? [],
    shazam: chartData?.shazam ?? [],
  };

  const filterTracks = (rows: ConsensusTrack[]) => (djOnly ? rows.filter(isDanceable) : rows);
  const filterEntries = (rows: ChartEntry[]) => (djOnly ? rows.filter(isDanceable) : rows);

  return <div className="space-y-10">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
      <div className="min-w-0">
        <p className="eyebrow">Workspace</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Home</h1>
      </div>
      <Button asChild size="sm" className="rounded-full"><Link to="/events/new">Create event <ArrowRight className="ml-2 size-4"/></Link></Button>
    </header>

    <section className="panel flex flex-wrap items-center gap-x-10 gap-y-5 px-6 py-5" aria-label="Overview">
      <Metric icon={Library} label="Library tracks" value={loading ? "…" : (library?.tracks.length ?? 0).toLocaleString()}/>
      <Metric icon={Music2} label="Music sources" value={sources.length.toString()}/>
      <Metric icon={CalendarDays} label="Saved events" value={events.length.toString()}/>
    </section>

    <section aria-label="Trending" className="panel px-5 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg tracking-tight"><TrendingUp className="size-4 text-primary"/> Trending now</h2>
        <Button size="sm" variant={djOnly ? "default" : "ghost"} className="rounded-full" onClick={() => setDjOnly(v => !v)}>
          <Flame className="mr-2 size-4"/>{djOnly ? "DJ picks" : "All tracks"}
        </Button>
      </div>
      <Tabs value={platform} onValueChange={setPlatform}>
        <TabsList className="flex-wrap rounded-full bg-muted/40">
          {platforms.map(p => <TabsTrigger key={p.id} value={p.id} className="rounded-full">{p.label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="all" className="mt-5">
          <div className="grid gap-8 xl:grid-cols-2">
            <div>
              <h3 className="mb-3 font-display text-base tracking-tight">Top tracks</h3>
              <ConsensusTrackList rows={filterTracks(chartData?.topTracks ?? [])} loading={chartsLoading} inLibrary={inLibrary} onPlay={play}/>
            </div>
            <div>
              <h3 className="mb-3 font-display text-base tracking-tight">Top artists</h3>
              <ArtistList rows={chartData?.topArtists ?? []} loading={chartsLoading} onPlay={play}/>

            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Ranked by agreement across Apple Music, Billboard, Last.fm and Shazam.</p>
        </TabsContent>

        {platforms.filter(p => p.id !== "all").map(p => <TabsContent key={p.id} value={p.id} className="mt-5">
          <ChartList rows={filterEntries(perPlatform[p.id] ?? [])} loading={chartsLoading} error={chartData?.errors?.[p.id as ChartSource]} inLibrary={inLibrary} onPlay={play}/>
        </TabsContent>)}
      </Tabs>
      {chartData ? <p className="mt-3 text-xs text-muted-foreground">Updated {new Date(chartData.fetchedAt).toLocaleString()}</p> : null}
    </section>


    <section className="grid gap-6 xl:grid-cols-2" aria-label="Your music">
      <div className="panel px-5 py-5 sm:px-6">
        <h2 className="mb-3 font-display text-lg tracking-tight">Your most played</h2>
        {topPlayed.length ? <ol className="hairline-y text-sm">
          {topPlayed.map((t, i) => <li key={`${t.filePath}-${i}`} className="group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
            <PlayButton label={t.title ?? "song"} onClick={() => play(t.artist ?? "", t.title ?? "", t.filePath)}/>
            <span className="min-w-0 truncate">{t.artist ? `${t.artist} — ` : ""}{t.title}{t.key ? ` · ${t.key}` : ""}</span>
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{(t.playCount ?? 0).toLocaleString()} plays</span>
          </li>)}

        </ol> : <p className="py-8 text-sm text-muted-foreground">Connect your VirtualDJ folder in Settings (Mac app) to see real play counts.</p>}
        <Button asChild variant="ghost" size="sm" className="mt-4 rounded-full"><Link to="/library"><Play size={15} className="mr-2"/> Open library</Link></Button>
      </div>
      <div className="panel px-5 py-5 sm:px-6">
        <h2 className="mb-3 font-display text-lg tracking-tight">Most requested</h2>
        {mostRequested.length ? <ol className="hairline-y text-sm">
          {mostRequested.map((r, i) => <li key={`${r.artist}-${r.song}`} className="group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
            <PlayButton label={r.song} onClick={() => play(r.artist, r.song)}/>
            <span className="min-w-0 truncate">{r.artist} — {r.song}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.events} {r.events === 1 ? "list" : "lists"}</span>
          </li>)}

        </ol> : <p className="py-8 text-sm text-muted-foreground">Songs that repeat across your client lists will appear here.</p>}
        <p className="mt-3 text-xs text-muted-foreground">Counted from songs on your uploaded client lists — {eventSongs} songs saved across events.</p>
      </div>
    </section>

    <section aria-label="Recent events" className="panel px-5 py-5 sm:px-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg tracking-tight">Recent events</h2>
        <Button asChild variant="ghost" size="sm" className="rounded-full"><Link to="/events">View all <ArrowRight className="ml-1 size-4"/></Link></Button>
      </div>
      {events.length ? <div className="hairline-y">
        {events.slice(0, 5).map(e => <Link to="/events/new" search={{ eventId: e.id }} key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-sm transition-colors hover:text-primary">
          <span className="min-w-0 truncate font-medium">{e.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span>
        </Link>)}
      </div> : <p className="py-8 text-sm text-muted-foreground">No events yet. Start with a client song list.</p>}
    </section>

    <WaveformPlayer target={playing} resolve={resolveFile} onClose={() => setPlaying(null)}/>
  </div>;

}

type PlayFn = (artist: string, song: string, filePath?: string) => void;

/** Artwork thumbnail with a play overlay on hover. */
function Art({ src, round, onPlay, label }: { src?: string; round?: boolean; onPlay: () => void; label: string }) {
  const shape = round ? "rounded-full" : "rounded-lg";
  return <span className="relative block size-11 shrink-0">
    {src
      ? <img src={src} alt="" loading="lazy" className={`size-11 object-cover ${shape}`}/>
      : <span className={`grid size-11 place-items-center bg-muted/60 ${shape}`}><Music2 className="size-4 text-muted-foreground"/></span>}
    <button type="button" aria-label={`Play ${label}`} title={`Play ${label}`} onClick={onPlay}
      className={`absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${shape}`}>
      <Play size={15} className="translate-x-px"/>
    </button>
  </span>;
}

function ChartList({ rows, loading, error, inLibrary, onPlay }: { rows: ChartEntry[]; loading: boolean; error?: string; inLibrary: (e: ChartEntry) => boolean; onPlay: PlayFn }) {
  if (loading) return <p className="py-8 text-sm text-muted-foreground">Loading the latest chart…</p>;
  if (error) return <p className="py-8 text-sm text-muted-foreground">{error}</p>;
  if (!rows.length) return <p className="py-8 text-sm text-muted-foreground">No tracks to show right now.</p>;
  return <ol className="grid gap-1 sm:grid-cols-2">
    {rows.slice(0, 40).map(e => {
      const owned = inLibrary(e);
      return <li key={`${e.source}-${e.rank}-${e.title}`} className="group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-accent/30">
        <span className="w-6 text-right tabular-nums text-sm text-muted-foreground">{e.rank}</span>
        <Art src={e.artwork} label={e.title} onPlay={() => onPlay(e.artist, e.title)}/>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{e.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{e.artist}{e.genre ? ` · ${e.genre}` : ""}</span>
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${owned ? "text-success" : "text-muted-foreground"}`}>
          {owned ? <Check className="size-3.5"/> : <AlertCircle className="size-3.5"/>}
          {owned ? "In library" : "Missing"}
        </span>
      </li>;
    })}
  </ol>;
}


function SourcePills({ sources }: { sources: { source: ChartSource; rank: number }[] }) {
  return <span className="flex flex-wrap items-center gap-1">
    {sources.map(s => <span key={s.source} className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
      {SOURCE_LABEL[s.source]} #{s.rank}
    </span>)}
  </span>;
}

function HeroPlay({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" aria-label={`Play ${label}`} title={`Play ${label}`} onClick={onClick}
    className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105">
    <Play size={18} className="translate-x-px"/>
  </button>;
}

function ConsensusTrackList({ rows, loading, inLibrary, onPlay }: { rows: ConsensusTrack[]; loading: boolean; inLibrary: (e: { artist: string; title: string }) => boolean; onPlay: PlayFn }) {
  if (loading) return <p className="py-8 text-sm text-muted-foreground">Loading the latest charts…</p>;
  if (!rows.length) return <p className="py-8 text-sm text-muted-foreground">No tracks to show right now.</p>;
  const [hero, ...rest] = rows;
  return <div>
    {hero ? <div className="relative mb-3 overflow-hidden rounded-2xl border border-border/40">
      {hero.artwork ? <img src={hero.artwork} alt="" className="h-44 w-full object-cover"/> : <div className="h-44 w-full bg-muted/50"/>}
      <HeroPlay label={hero.title} onClick={() => onPlay(hero.artist, hero.title)}/>
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-4">
        <span className="font-display text-3xl font-semibold leading-none text-white/90">1</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-semibold text-white">{hero.title}</span>
          <span className="block truncate text-sm text-white/70">{hero.artist}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {hero.sources.map(s => <span key={s.source} className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-white/85">{SOURCE_LABEL[s.source]} #{s.rank}</span>)}
            {hero.sources.length >= 3 ? <span className="rounded-full bg-primary/85 px-2 py-0.5 text-[10px] font-medium text-primary-foreground">Cross-platform</span> : null}
          </span>
        </span>
        <span className={`shrink-0 text-[11px] ${inLibrary(hero) ? "text-success" : "text-white/70"}`}>
          {inLibrary(hero) ? "In library" : "Missing"}
        </span>
      </div>
    </div> : null}
    <ol className="grid gap-1">
      {rest.slice(0, 14).map(t => {
        const owned = inLibrary(t);
        return <li key={`${t.rank}-${t.title}`} className="group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent/30">
          <span className="w-5 text-right tabular-nums text-sm text-muted-foreground">{t.rank}</span>
          <Art src={t.artwork} label={t.title} onPlay={() => onPlay(t.artist, t.title)}/>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{t.artist}</span>
            <SourcePills sources={t.sources}/>
          </span>
          <span className={`flex shrink-0 items-center gap-1 text-[11px] ${owned ? "text-success" : "text-muted-foreground"}`}>
            {owned ? <Check className="size-3.5"/> : <AlertCircle className="size-3.5"/>}
          </span>
        </li>;
      })}
    </ol>
  </div>;
}


function ArtistList({ rows, loading, onPlay }: { rows: ConsensusArtist[]; loading: boolean; onPlay: PlayFn }) {
  if (loading) return <p className="py-8 text-sm text-muted-foreground">Loading the latest charts…</p>;
  if (!rows.length) return <p className="py-8 text-sm text-muted-foreground">No artists to show right now.</p>;
  const [hero, ...rest] = rows;
  const sub = (a: ConsensusArtist) => [
    a.hits ? `${a.hits} charting ${a.hits === 1 ? "hit" : "hits"}` : null,
    compact(a.listeners) ? `${compact(a.listeners)} listeners` : null,
  ].filter(Boolean).join(" · ");
  return <div>
    {hero ? <div className="relative mb-3 overflow-hidden rounded-2xl border border-border/40">
      {hero.artwork ? <img src={hero.artwork} alt="" className="h-44 w-full object-cover"/> : <div className="h-44 w-full bg-muted/50"/>}
      {hero.topTrack ? <HeroPlay label={hero.topTrack} onClick={() => onPlay(hero.artist, hero.topTrack!)}/> : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-4">
        <span className="font-display text-3xl font-semibold leading-none text-white/90">1</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-semibold text-white">{hero.artist}</span>
          <span className="block truncate text-sm text-white/70">{sub(hero) || "Trending now"}</span>
          {hero.topTrack ? <span className="block truncate text-xs text-white/55">Top track: {hero.topTrack}</span> : null}
        </span>
      </div>
    </div> : null}
    <ol className="grid gap-1">
      {rest.slice(0, 14).map(a => <li key={`${a.rank}-${a.artist}`} className="group grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent/30">
        <span className="w-5 text-right tabular-nums text-sm text-muted-foreground">{a.rank}</span>
        <Art src={a.artwork} round label={a.topTrack ?? a.artist} onPlay={() => onPlay(a.artist, a.topTrack ?? "")}/>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{a.artist}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub(a) || a.topTrack || ""}</span>
        </span>
      </li>)}
    </ol>

  </div>;
}


function Metric({ icon: Icon, label, value }: { icon: typeof Library; label: string; value: string }) {
  return <div className="flex items-center gap-3">
    <Icon className="size-4 text-primary"/>
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  </div>;
}
