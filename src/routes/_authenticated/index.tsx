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
  return <div className="space-y-9">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-7"><div><p className="text-xs font-semibold uppercase text-primary">Workspace</p><h1 className="mt-2 font-display text-4xl font-semibold">Home</h1><p className="mt-2 text-muted-foreground">Your music and events, all in one place.</p></div><Button asChild><Link to="/events/new">Create event <ArrowRight className="ml-2 size-4"/></Link></Button></header>
    <section className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3" aria-label="Overview"><Metric icon={Library} label="Library tracks" value={loading ? "…" : (library?.tracks.length ?? 0).toLocaleString()}/><Metric icon={Music2} label="Music sources" value={sources.length.toString()}/><Metric icon={CalendarDays} label="Saved events" value={events.length.toString()}/></section>
    <section className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]"><div><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Recent events</h2><Button asChild variant="ghost" size="sm"><Link to="/events">View all <ArrowRight className="ml-1 size-4"/></Link></Button></div>{events.length ? <div className="divide-y divide-border border-y border-border">{events.slice(0,5).map(e => <Link to="/events/new" search={{eventId:e.id}} key={e.id} className="flex items-center justify-between gap-4 py-4 hover:text-primary"><span className="font-medium">{e.name}</span><span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span></Link>)}</div> : <p className="border-y border-border py-8 text-sm text-muted-foreground">No events yet. Start with a client song list.</p>}</div><div><h2 className="mb-4 font-display text-2xl">Music activity</h2><div className="space-y-3 border-y border-border py-5 text-sm"><p className="flex justify-between"><span className="text-muted-foreground">Songs in saved event lists</span><strong>{eventSongs}</strong></p><p className="text-muted-foreground">Most requested: event-list selections are not verified guest requests.</p><p className="text-muted-foreground">Most played and trending: no verified play history from connected folders. Add VirtualDJ history data when available.</p></div><Button asChild variant="outline" className="mt-5"><Link to="/library"><Play size={15} className="mr-2"/> Open library</Link></Button></div></section>
  </div>;
}
function Metric({icon:Icon,label,value}:{icon:typeof Library;label:string;value:string}) {return <div className="bg-background px-5 py-6"><Icon className="mb-5 size-5 text-primary"/><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p></div>}
