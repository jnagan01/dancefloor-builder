import { useState } from "react";
import { X, Save, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { activeChips, clearChip, EMPTY_FILTER, type FilterContext, type FilterState, type UnknownMode, type facetOptions } from "@/lib/prep/filters";
import { savePreset, renamePreset, deletePreset } from "@/lib/prep/knowledge";
import { usePrep } from "./usePrep";

type Options = ReturnType<typeof facetOptions>;
const sel = "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground";

function UnknownSelect({ value, onChange, label }: { value: UnknownMode; onChange: (m: UnknownMode) => void; label: string }) {
  return <select className={sel} aria-label={`${label}: unknown values`} value={value} onChange={e => onChange(e.target.value as UnknownMode)}>
    <option value="include">Keep unknown</option><option value="exclude">Exclude unknown</option><option value="only">Only unknown</option>
  </select>;
}
function RangeInputs({ value, onChange, label, step = 1, unit }: { value: [number, number] | null; onChange: (v: [number, number] | null) => void; label: string; step?: number; unit?: string }) {
  const [lo, setLo] = useState(value ? String(value[0]) : ""), [hi, setHi] = useState(value ? String(value[1]) : "");
  const commit = (a: string, b: string) => { const x = Number(a), y = Number(b); onChange(a === "" && b === "" ? null : a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y) && x <= y ? [x, y] : value); };
  return <span className="flex items-center gap-1">
    <Input className="h-8 w-16 text-xs" inputMode="decimal" step={step} aria-label={`${label} minimum${unit ? ` (${unit})` : ""}`} placeholder="min" value={lo} onChange={e => setLo(e.target.value)} onBlur={() => commit(lo, hi)} />
    <span className="text-xs text-muted-foreground">–</span>
    <Input className="h-8 w-16 text-xs" inputMode="decimal" step={step} aria-label={`${label} maximum${unit ? ` (${unit})` : ""}`} placeholder="max" value={hi} onChange={e => setHi(e.target.value)} onBlur={() => commit(lo, hi)} />
    {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
  </span>;
}

/** Combined filter panel. Only fields that carry real values in this context are offered. */
export function FilterPanel({ context, options, value, onChange, shown }: { context: FilterContext; options: Options; value: FilterState; onChange: (f: FilterState) => void; shown: number }) {
  const { knowledge, ready, mutate } = usePrep();
  const [genreQuery, setGenreQuery] = useState("");
  const [presetName, setPresetName] = useState("");
  const [rev, setRev] = useState(0); // remount range inputs after reset/preset
  const chips = activeChips(value, context);
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const apply = (f: FilterState) => { onChange(f); setRev(r => r + 1); };
  const presets = knowledge.presets.filter(p => p.context === context);
  const genres = options.genres.filter(g => !genreQuery || g.label.toLowerCase().includes(genreQuery.toLowerCase())).slice(0, 60);
  const known = (n: number) => `${n.toLocaleString()} of ${options.total.toLocaleString()} known`;
  return <section aria-label="Filters" className="space-y-3 border border-border bg-card p-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Filters</p>
      <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{chips.length} active · {shown.toLocaleString()} shown</span>
      {chips.map(c => <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
        {c.label}<button type="button" aria-label={`Remove filter ${c.label}`} className="hover:text-primary" onClick={() => apply(clearChip(value, c.id))}><X size={12} /></button></span>)}
      {chips.length > 0 && <Button size="sm" variant="ghost" onClick={() => apply(EMPTY_FILTER)}>Reset all</Button>}
    </div>
    <div key={rev} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Genre <span className="text-muted-foreground">({options.genreUnknown.toLocaleString()} unknown)</span></legend>
        <div className="flex gap-1"><Input className="h-8 text-xs" placeholder="Find genre" aria-label="Find genre" value={genreQuery} onChange={e => setGenreQuery(e.target.value)} /><UnknownSelect label="Genre" value={value.genreUnknown} onChange={m => set({ genreUnknown: m })} /></div>
        <div className="max-h-28 overflow-auto rounded border border-border p-1">{genres.length ? genres.map(g => { const on = value.genres.some(x => x.toLowerCase() === g.label.toLowerCase()); return <label key={g.label} className="flex items-center gap-2 px-1 text-xs"><input type="checkbox" checked={on} onChange={() => set({ genres: on ? value.genres.filter(x => x.toLowerCase() !== g.label.toLowerCase()) : [...value.genres, g.label] })} />{g.label} <span className="ml-auto tabular-nums text-muted-foreground">{g.n.toLocaleString()}</span></label>; }) : <p className="px-1 text-xs text-muted-foreground">No genre values found</p>}</div>
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Decade <span className="text-muted-foreground">({options.decadeUnknown.toLocaleString()} unknown)</span></legend>
        <div className="flex flex-wrap gap-1">{options.decades.map(d => { const on = value.decades.includes(d.label); return <Button key={d.label} size="sm" variant={on ? "default" : "outline"} className="h-7 px-2 text-xs" aria-pressed={on} onClick={() => set({ decades: on ? value.decades.filter(x => x !== d.label) : [...value.decades, d.label] })}>{d.label} <span className="ml-1 opacity-70">{d.n}</span></Button>; })}</div>
        <UnknownSelect label="Decade" value={value.decadeUnknown} onChange={m => set({ decadeUnknown: m })} />
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="text-xs font-medium">BPM <span className="text-muted-foreground">({known(options.bpmKnown)})</span></legend>
        <div className="flex flex-wrap items-center gap-2"><RangeInputs label="BPM" value={value.bpm} onChange={v => set({ bpm: v })} /><UnknownSelect label="BPM" value={value.bpmUnknown} onChange={m => set({ bpmUnknown: m })} /></div>
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Length <span className="text-muted-foreground">({known(options.durationKnown)})</span></legend>
        <div className="flex flex-wrap items-center gap-2"><RangeInputs label="Length" unit="min" step={0.5} value={value.duration ? [value.duration[0] / 60, value.duration[1] / 60] : null} onChange={v => set({ duration: v ? [Math.round(v[0] * 60), Math.round(v[1] * 60)] : null })} /><UnknownSelect label="Length" value={value.durationUnknown} onChange={m => set({ durationUnknown: m })} /></div>
        {options.durationKnown === 0 && <p className="text-[11px] text-muted-foreground">Lengths come from your VirtualDJ database; sync it to fill them in.</p>}
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Clean / explicit <span className="text-muted-foreground">({known(options.cleanKnown)}{context === "library" ? ", from file names — not verified" : ""})</span></legend>
        <div className="flex flex-wrap items-center gap-2"><select className={sel} aria-label="Clean or explicit" value={value.clean ?? ""} onChange={e => set({ clean: (e.target.value || null) as FilterState["clean"] })}><option value="">Any</option><option value="clean">Labelled clean</option><option value="explicit">Labelled explicit</option></select><UnknownSelect label="Clean/explicit" value={value.cleanUnknown} onChange={m => set({ cleanUnknown: m })} /></div>
      </fieldset>
      {context === "recommendation" && <>
        <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Energy 0–10 <span className="text-muted-foreground">({known(options.energyKnown)}; estimates, never from BPM)</span></legend>
          <div className="flex flex-wrap items-center gap-2"><RangeInputs label="Energy" value={value.energy} onChange={v => set({ energy: v })} /><UnknownSelect label="Energy" value={value.energyUnknown} onChange={m => set({ energyUnknown: m })} /></div>
        </fieldset>
        <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Owned files <span className="text-muted-foreground">({options.owned.toLocaleString()} owned)</span></legend>
          <select className={sel} aria-label="Owned files" value={value.owned ?? ""} onChange={e => set({ owned: (e.target.value || null) as FilterState["owned"] })}><option value="">Owned and not owned</option><option value="owned">Only songs I own</option><option value="notOwned">Only songs I don't own</option></select>
        </fieldset>
      </>}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <span className="text-xs text-muted-foreground">Saved filters:</span>
      {presets.map(p => <span key={p.id} className="inline-flex items-center gap-0.5 rounded border border-border px-1">
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => apply(p.filter)}>{p.name}</Button>
        <button type="button" aria-label={`Rename ${p.name}`} className="p-1 hover:text-primary" onClick={() => { const n = window.prompt("Rename saved filter", p.name); if (n) void mutate(k => renamePreset(k, p.id, n)); }}><Pencil size={12} /></button>
        <button type="button" aria-label={`Delete ${p.name}`} className="p-1 hover:text-destructive" onClick={() => void mutate(k => deletePreset(k, p.id))}><Trash2 size={12} /></button>
      </span>)}
      <Input className="h-8 w-40 text-xs" placeholder="Name this filter" aria-label="Saved filter name" value={presetName} onChange={e => setPresetName(e.target.value)} />
      <Button size="sm" variant="outline" disabled={!ready || !presetName.trim() || !chips.length} onClick={async () => { if (await mutate(k => savePreset(k, presetName, context, value))) setPresetName(""); }}><Save size={14} className="mr-1" />Save</Button>
    </div>
  </section>;
}
