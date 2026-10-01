import { vibeFit, vibeRange, type VibeFit, type Targets, type Range } from "@/lib/vibes";
import type { RampSection } from "./EventEnergyRamp";

type Sec = "warmUp" | "transition" | "peak";

const fmt = (r: Range) => `${r[0]}–${r[1]}`;

function avg(xs: (number | undefined)[]) {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}

const LABELS: Record<VibeFit, { label: string; cls: string }> = {
  inside: { label: "Inside", cls: "bg-success/15 text-success" },
  low: { label: "Too low", cls: "bg-info/15 text-info" },
  high: { label: "Too high", cls: "bg-warning/15 text-warning" },
  unknown: { label: "No data", cls: "bg-muted text-muted-foreground" },
};

export function VibeBreakdown<K extends Sec>({
  targets,
  sections,
  onJump,
}: {
  targets: Targets | null;
  sections: RampSection<K>[];
  onJump?: (section: K) => void;
}) {
  const v = targets;
  if (!v) return null;

  const rows = sections.map((s) => {
    const fits = s.songs.map((song) => ({ song, fit: vibeFit(song, v, s.key) }));
    const counts = { inside: 0, low: 0, high: 0, unknown: 0 } as Record<VibeFit, number>;
    fits.forEach((f) => counts[f.fit]++);
    return {
      ...s,
      range: vibeRange(v, s.key),
      e: avg(s.songs.map((t) => t.energy)),
      d: avg(s.songs.map((t) => t.danceability)),
      b: avg(s.songs.map((t) => t.bpm)),
      counts,
      fits,
    };
  });
  const total = { inside: 0, low: 0, high: 0, unknown: 0 } as Record<VibeFit, number>;
  rows.forEach((r) => (Object.keys(total) as VibeFit[]).forEach((k) => (total[k] += r.counts[k])));
  const known = total.inside + total.low + total.high;

  const outliers = rows
    .flatMap((r) =>
      r.fits
        .filter((f) => f.fit === "low" || f.fit === "high")
        .map((f) => {
          const e = f.song.energy;
          const re = r.range.energy;
          const dist = typeof e === "number" && re ? (f.fit === "low" ? re[0] - e : e - re[1]) : f.fit === "low" || f.fit === "high" ? 0.1 : 0;
          return { ...f, sec: r.key, secLabel: r.label, dist };
        }),
    )
    .sort((a, b) => b.dist - a.dist)
    .slice(0, 8);

  const Pills = ({ c }: { c: Record<VibeFit, number> }) => (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(LABELS) as VibeFit[]).map((k) => (
        <span key={k} className={`rounded-full px-2 py-0.5 text-xs ${LABELS[k].cls}`}>
          {LABELS[k].label} {c[k]}
        </span>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-lg border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground">{v.label ?? "Custom targets"}</div>
        <div className="text-xs text-muted-foreground">
          {[v.description, v.energy && `energy ${fmt(v.energy)}`, v.bpm && `${fmt(v.bpm)} BPM`, v.dance && `danceability ${fmt(v.dance)}`].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-2xl font-semibold text-foreground">{known ? Math.round((total.inside / known) * 100) : 0}%</span>
          <span className="text-xs text-muted-foreground">of rated songs on target across the event</span>
        </div>
        <div className="mt-2"><Pills c={total} /></div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((r) => (
          <button key={r.key} type="button" onClick={() => onJump?.(r.key)} className="rounded-lg border border-border bg-card/60 p-4 text-left transition hover:border-primary/50">
            <div className="text-sm font-semibold text-foreground">{r.label} <span className="font-normal text-muted-foreground">· {r.songs.length} songs</span></div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted-foreground">Energy</dt><dd className="text-base text-foreground">{r.e?.toFixed(1) ?? "—"}</dd>{r.range.energy && <dd className="text-muted-foreground">target {fmt(r.range.energy)}</dd>}</div>
              <div><dt className="text-muted-foreground">Dance</dt><dd className="text-base text-foreground">{r.d?.toFixed(1) ?? "—"}</dd>{r.range.dance && <dd className="text-muted-foreground">target {fmt(r.range.dance)}</dd>}</div>
              <div><dt className="text-muted-foreground">BPM</dt><dd className="text-base text-foreground">{r.b ? Math.round(r.b) : "—"}</dd>{r.range.bpm && <dd className="text-muted-foreground">target {fmt(r.range.bpm)}</dd>}</div>
            </dl>
            <div className="mt-3"><Pills c={r.counts} /></div>
          </button>
        ))}
      </div>

      {outliers.length > 0 && (
        <div className="rounded-lg border border-border bg-card/60 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Furthest off the vibe</h4>
          <ul className="mt-2 divide-y divide-border">
            {outliers.map((o, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate"><span className="text-foreground">{o.song.song}</span> <span className="text-muted-foreground">— {o.song.artist}</span></span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${LABELS[o.fit].cls}`}>{LABELS[o.fit].label} · E {o.song.energy ?? "—"}</span>
                  <button type="button" onClick={() => onJump?.(o.sec)} className="text-primary hover:underline">Open {o.secLabel}</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
