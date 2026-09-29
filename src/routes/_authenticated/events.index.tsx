import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listWorkflows, deleteWorkflow, renameWorkflow } from "@/lib/history.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Trash2, Pencil, ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { pageHead } from "@/lib/pageHead";
export const Route = createFileRoute("/_authenticated/events/")({ component: EventsPage, head: () => pageHead("Events", "Browse your saved events and build new dance floor lists.") });
function EventsPage() {
 const list = useServerFn(listWorkflows), remove = useServerFn(deleteWorkflow), rename = useServerFn(renameWorkflow);
 const qc = useQueryClient(), navigate = useNavigate();
 const { data: rows = [], isLoading } = useQuery({ queryKey:["workflowHistory"], queryFn: () => list() });
 const [query,setQuery] = useState(""); const [editing,setEditing] = useState<string|null>(null); const [name,setName] = useState("");
 const filtered = rows.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));
 return <div className="space-y-7"><header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-7"><div><p className="text-xs font-semibold uppercase text-primary">Your work</p><h1 className="mt-2 font-display text-4xl">Events</h1><p className="mt-2 text-sm text-muted-foreground">{rows.length} saved events</p></div><Button asChild><Link to="/events/new"><Plus size={16} className="mr-2"/> New event</Link></Button></header><div className="relative max-w-sm"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input aria-label="Search events" className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search events"/></div><div className="divide-y divide-border border-y border-border">{isLoading && <p className="py-8 text-muted-foreground">Loading events…</p>}{!isLoading && !filtered.length && <p className="py-10 text-muted-foreground">No events found.</p>}{filtered.map(row=><div key={row.id} className="flex flex-wrap items-center gap-4 py-4"><div className="min-w-0 flex-1">{editing===row.id ? <div className="flex gap-2"><Input aria-label="Event name" value={name} onChange={e=>setName(e.target.value)}/><Button onClick={async()=>{try{await rename({data:{id:row.id,name:name.trim()}}); setEditing(null); void qc.invalidateQueries({queryKey:["workflowHistory"]});}catch{toast.error("Could not rename event")}}} disabled={!name.trim()}>Save</Button></div> : <><p className="font-medium">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleDateString()} · {row.counts.warmUp} Warm Up / {row.counts.transition} Transition / {row.counts.peak} Peak</p></>}</div><Button size="icon" variant="ghost" aria-label={`Rename ${row.name}`} onClick={()=>{setEditing(row.id);setName(row.name)}}><Pencil size={15}/></Button><Button size="icon" variant="ghost" aria-label={`Delete ${row.name}`} onClick={async()=>{if(!window.confirm(`Delete ${row.name}?`))return;try{await remove({data:{id:row.id}});void qc.invalidateQueries({queryKey:["workflowHistory"]});}catch{toast.error("Could not delete event")}}}><Trash2 size={15}/></Button><Button variant="outline" onClick={()=>navigate({to:"/events/new",search:{eventId:row.id}})}>Open <ArrowRight size={15} className="ml-2"/></Button></div>)}</div></div>
}
