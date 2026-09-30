import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, Library, Music2, ArrowRight, Play, TrendingUp, Check, AlertCircle, Flame } from "lucide-react";
import { listWorkflows, listMostRequested } from "@/lib/history.functions";
import { getTrendingCharts, type ChartEntry } from "@/lib/charts.functions";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { pageHead } from "@/lib/pageHead";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
  head: () => pageHead("Home", "Trending charts, your most played tracks and most requested songs in one place."),
});

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\(.*?\)|\[.*?\]/g, "").replace(/feat\.?.*$/, "").replace(/[^a-z0-9]+/g, " ").trim();

const DANCE_WORDS = ["dance", "pop", "hip-hop", "hip hop", "rap", "house", "electronic", "r&b", "soul", "latin", "reggae", "funk", "disco", "edm"];
const isDanceable = (e: ChartEntry) => !e.genre || DANCE_WORDS.some(w => e.genre!.toLowerCase().includes(w));

function HomePage() {
  const { library, sources, loading } = useWorkspace();
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

  const libraryKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of sources) for (const t of s.tracks) {
      if (t.title) set.add(`${norm(t.artist ?? "")}|${norm(t.title)}`);
      if (t.title) set.add(norm(t.title));
    }
    return set;
  }, [sources]);

  const inLibrary = (e: ChartEntry) =>
    libraryKeys.has(`${norm(e.artist)}|${norm(e.title)}`) || libraryKeys.has(norm(e.title));

  const eventSongs = events.reduce((n, e) => n + e.counts.warmUp + e.counts.transition + e.counts.peak, 0);
  const topPlayed = sources.flatMap(s => s.tracks).filter(t => (t.playCount ?? 0) > 0)
    .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 8);

  const apple = chartData?.apple ?? [];
  const billboard = chartData?.billboard ?? [];
  const filter = (rows: ChartEntry[]) => (djOnly ? rows.filter(isDanceable) : rows);

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
      <Tabs defaultValue="apple">
        <TabsList className="rounded-full bg-muted/40">
          <TabsTrigger value="apple" className="rounded-full">Apple Music</TabsTrigger>
          <TabsTrigger value="billboard" className="rounded-full">Billboard Hot 100</TabsTrigger>
        </TabsList>
        <TabsContent value="apple" className="mt-4">
          <ChartList rows={filter(apple)} loading={chartsLoading} error={chartData?.appleError} inLibrary={inLibrary}/>
        </TabsContent>
        <TabsContent value="billboard" className="mt-4">
          <ChartList rows={filter(billboard)} loading={chartsLoading} error={chartData?.billboardError} inLibrary={inLibrary}/>
        </TabsContent>
      </Tabs>
      {chartData ? <p className="mt-3 text-xs text-muted-foreground">Updated {new Date(chartData.fetchedAt).toLocaleString()}</p> : null}
    </section>

    <section className="grid gap-6 xl:grid-cols-2" aria-label="Your music">
      <div className="panel px-5 py-5 sm:px-6">
        <h2 className="mb-3 font-display text-lg tracking-tight">Your most played</h2>
        {topPlayed.length ? <ol className="hairline-y text-sm">
          {topPlayed.map((t, i) => <li key={`${t.filePath}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 truncate">{t.artist ? `${t.artist} — ` : ""}{t.title}{t.key ? ` · ${t.key}` : ""}</span>
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{(t.playCount ?? 0).toLocaleString()} plays</span>
          </li>)}
        </ol> : <p className="py-8 text-sm text-muted-foreground">Connect your VirtualDJ folder in Settings (Mac app) to see real play counts.</p>}
        <Button asChild variant="ghost" size="sm" className="mt-4 rounded-full"><Link to="/library"><Play size={15} className="mr-2"/> Open library</Link></Button>
      </div>
      <div className="panel px-5 py-5 sm:px-6">
        <h2 className="mb-3 font-display text-lg tracking-tight">Most requested</h2>
        {mostRequested.length ? <ol className="hairline-y text-sm">
          {mostRequested.map((r, i) => <li key={`${r.artist}-${r.song}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
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
  </div>;
}

function ChartList({ rows, loading, error, inLibrary }: { rows: ChartEntry[]; loading: boolean; error?: string; inLibrary: (e: ChartEntry) => boolean }) {
  if (loading) return <p className="py-8 text-sm text-muted-foreground">Loading the latest chart…</p>;
  if (error) return <p className="py-8 text-sm text-muted-foreground">{error}</p>;
  if (!rows.length) return <p className="py-8 text-sm text-muted-foreground">No tracks to show right now.</p>;
  return <ol className="grid gap-1 sm:grid-cols-2">
    {rows.slice(0, 40).map(e => {
      const owned = inLibrary(e);
      return <li key={`${e.source}-${e.rank}-${e.title}`} className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-accent/30">
        <span className="w-6 text-right tabular-nums text-sm text-muted-foreground">{e.rank}</span>
        {e.artwork
          ? <img src={e.artwork} alt="" loading="lazy" className="size-10 rounded-lg object-cover"/>
          : <span className="grid size-10 place-items-center rounded-lg bg-muted/60"><Music2 className="size-4 text-muted-foreground"/></span>}
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

function Metric({ icon: Icon, label, value }: { icon: typeof Library; label: string; value: string }) {
  return <div className="flex items-center gap-3">
    <Icon className="size-4 text-primary"/>
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  </div>;
}
