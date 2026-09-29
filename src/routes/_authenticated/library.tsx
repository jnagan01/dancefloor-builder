import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { WaveformPlayer } from "@/components/workspace/WaveformPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, RefreshCw, Search, Columns3, Play, Pencil } from "lucide-react";
import { pageHead } from "@/lib/pageHead";

export const Route = createFileRoute("/_authenticated/library")({ component: LibraryPage, head: () => pageHead("Library", "Search, play, and edit the tracks in your connected music folders.") });
const fields = ["Title", "Artist", "Album", "BPM", "Year", "Genre", "Key", "Plays", "File path"] as const;
type Field = typeof fields[number];
function LibraryPage() {
  const { sources, library, files, addFolder, rescan, editTrack } = useWorkspace();
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<Field[]>(["Title", "Artist", "BPM", "Year", "Genre", "Key", "File path"]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [editing, setEditing] = useState<{source:number;index:number}|null>(null);
  const [playing, setPlaying] = useState<{artist:string; song:string; filePath:string}|null>(null);
  const rows = useMemo(() => sources.flatMap((s, si) => s.tracks.map((t, ti) => ({t, si, ti})))
    .filter(({t}) => `${t.artist} ${t.title} ${t.filePath}`.toLowerCase().includes(query.toLowerCase())).slice(0, 300), [sources, query]);
  const current = editing ? sources[editing.source]?.tracks[editing.index] : null;
  const resolveFile = (q:{filePath?:string}) => files.find(f => (f.webkitRelativePath || f.name) === q.filePath || f.name === q.filePath?.split("/").pop());
  return <div className="space-y-5 pb-20">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-b border-border pb-5">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase text-primary">Music collection</p><h1 className="mt-2 font-display text-2xl sm:text-3xl">Library</h1></div>
      <Button size="sm" onClick={addFolder}><Plus size={16} className="mr-1.5"/> <span className="hidden sm:inline">Add music source</span><span className="sm:hidden">Add source</span></Button>
    </header>
    <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
      <div className="bg-card px-4 py-3"><p className="text-[11px] uppercase text-muted-foreground">Tracks</p><p className="text-xl font-semibold tabular-nums">{library?.tracks.length.toLocaleString() ?? 0}</p></div>
      <div className="bg-card px-4 py-3"><p className="text-[11px] uppercase text-muted-foreground">Music sources</p><p className="text-xl font-semibold tabular-nums">{sources.length}</p></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-sm"><Search size={16} className="absolute left-3 top-3 text-muted-foreground"/><Input className="pl-9" placeholder="Search tracks and file paths" aria-label="Search library" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="flex shrink-0 gap-1"><Button size="icon" variant="ghost" title="Rescan folder" aria-label="Rescan folder" onClick={rescan}><RefreshCw size={17}/></Button><Button size="icon" variant="outline" title="Choose columns" aria-label="Choose columns" onClick={()=>setColumnsOpen(true)}><Columns3 size={17}/></Button></div>
    </div>
    <p className="text-xs text-muted-foreground">Folder paths are relative to the selected folder. Reconnect a folder after reopening the app to play its audio.</p>
    <div className="overflow-x-auto border border-border"><table className="w-full text-left text-sm"><thead className="border-b border-border"><tr><th scope="col">Play</th>{fields.filter(f=>columns.includes(f)).map(f=><th scope="col" key={f}>{f}</th>)}<th scope="col">Edit</th></tr></thead><tbody className="divide-y divide-border">{rows.map(({t,si,ti})=>{const file=resolveFile({filePath:t.filePath});return <tr key={`${si}:${ti}`}><td><Button size="icon" variant="ghost" disabled={!file} title={file?"Play local file":"Reconnect music folder to play"} aria-label={`Play ${t.title}`} onClick={()=>setPlaying({artist:t.artist,song:t.title,filePath:t.filePath})}><Play size={15}/></Button></td>{fields.filter(f=>columns.includes(f)).map(f=><td key={f} className={f==="File path"?"min-w-52 max-w-sm break-all text-xs text-muted-foreground":f==="Title"?"min-w-44 font-medium":"whitespace-nowrap"}>{f==="Artist"?t.artist:f==="Title"?t.title:f==="File path"?t.filePath:(t as unknown as Record<string,unknown>)[f.toLowerCase()]?.toString()||"—"}</td>)}<td><Button size="icon" variant="ghost" aria-label={`Edit ${t.title}`} title="Edit track" onClick={()=>setEditing({source:si,index:ti})}><Pencil size={15}/></Button></td></tr>})}</tbody></table>{!rows.length && <p className="py-10 text-center text-sm text-muted-foreground">{sources.length?"No tracks match your search":"Add a music folder to start your library"}</p>}</div>
    <WaveformPlayer target={playing} resolve={resolveFile} onClose={()=>setPlaying(null)}/>
    <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}><DialogContent><DialogHeader><DialogTitle>Choose columns</DialogTitle></DialogHeader><div className="grid grid-cols-2 gap-3">{fields.map(f=><label key={f} className="flex items-center gap-2 text-sm"><Checkbox checked={columns.includes(f)} onCheckedChange={v=>setColumns(prev=>v?[...prev,f]:prev.filter(x=>x!==f))}/>{f}</label>)}</div></DialogContent></Dialog>
    <Dialog open={!!current} onOpenChange={open=>{if(!open)setEditing(null)}}><DialogContent><DialogHeader><DialogTitle>Edit track metadata</DialogTitle></DialogHeader>{current&&editing&&<div className="space-y-3">{(["artist","title","bpm","year","genre","key"] as const).map(field=><label key={field} className="block text-sm capitalize">{field}<Input className="mt-1" value={current[field]??""} onChange={e=>editTrack(editing.source,editing.index,{[field]:e.target.value})}/></label>)}<p className="text-xs text-muted-foreground">Edits update this library’s index, not the original audio file.</p><Button onClick={()=>setEditing(null)}>Done</Button></div>}</DialogContent></Dialog>
  </div>;
}