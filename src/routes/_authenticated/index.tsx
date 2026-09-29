import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Library, Music2, ArrowRight, Play } from "lucide-react";
import { listWorkflows } from "@/lib/history.functions";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/pageHead";

export const Route = createFileRoute("/_authenticated/")({ component: HomePage, head: () => pageHead("Home", "Your music library and event activity at a glance.") });
function HomePage() {
  const { library, sources, loading } = useWorkspace();
  const list = useServerFn(listWorkflows);
  const { data: events = [] } = useQuery({ queryKey: ["workflowHistory"], queryFn: () => list() });
  const eventSongs = events.reduce((n, e) => n + e.counts.warmUp + e.counts.transition + e.counts.peak, 0);
  const topPlayed = sources.flatMap(s => s.tracks).filter(t => (t.playCount ?? 0) > 0).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 5);
  return <div className="space-y-6">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-b border-border pb-5"><div className="min-w-0"><p className="text-xs font-semibold uppercase text-primary">Workspace</p><h1 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">Home</h1></div><Button asChild size="sm"><Link to="/events/new">Create event <ArrowRight className="ml-2 size-4"/></Link></Button></header>
    <section className="grid gap-px border border-border bg-border sm:grid-cols-3" aria-label="Overview"><Metric icon={Library} label="Library tracks" value={loading ? "…" : (library?.tracks.length ?? 0).toLocaleString()}/><Metric icon={Music2} label="Music sources" value={sources.length.toString()}/><Metric icon={CalendarDays} label="Saved events" value={events.length.toString()}/></section>
    <section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]"><div><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg">Recent events</h2><Button asChild variant="ghost" size="sm"><Link to="/events">View all <ArrowRight className="ml-1 size-4"/></Link></Button></div>{events.length ? <div className="divide-y divide-border border-y border-border">{events.slice(0,5).map(e => <Link to="/events/new" search={{eventId:e.id}} key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-sm hover:text-primary"><span className="min-w-0 truncate font-medium">{e.name}</span><span className="shrink-0 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span></Link>)}</div> : <p className="border-y border-border py-8 text-sm text-muted-foreground">No events yet. Start with a client song list.</p>}</div><div><h2 className="mb-3 font-display text-lg">Music activity</h2><div className="space-y-3 border-y border-border py-4 text-sm"><p className="flex justify-between"><span className="text-muted-foreground">Songs in saved event lists</span><strong>{eventSongs}</strong></p><p className="text-muted-foreground">Most requested: event-list selections are not verified guest requests.</p>{topPlayed.length?<div className="space-y-1"><p className="text-muted-foreground">Most played</p><ol className="space-y-1">{topPlayed.map((t,i)=><li key={`${t.filePath}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><span className="min-w-0 truncate">{t.artist?`${t.artist} — `:""}{t.title}{t.key?` · ${t.key}`:""}</span><span className="shrink-0 tabular-nums text-muted-foreground">{(t.playCount??0).toLocaleString()} plays</span></li>)}</ol></div>:<p className="text-muted-foreground">Most played and trending: sync your VirtualDJ database in Settings (Mac app) to see real play counts.</p>}</div><Button asChild variant="outline" size="sm" className="mt-4"><Link to="/library"><Play size={15} className="mr-2"/> Open library</Link></Button></div></section>
  </div>;
}
function Metric({icon:Icon,label,value}:{icon:typeof Library;label:string;value:string}) {return <div className="bg-card px-4 py-4"><Icon className="mb-3 size-4 text-primary"/><p className="text-[11px] uppercase text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>}
