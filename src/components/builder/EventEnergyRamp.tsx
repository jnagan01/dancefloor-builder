import { useMemo, useState } from "react";

export type RampSong = {
  song: string;
  artist: string;
  energy?: number;
  danceability?: number;
  bpm?: number;
  key?: string;
};
export type RampSection<K extends string> = { key: K; label: string; songs: RampSong[] };

const W = 1000;
const H = 220;
const PAD = { l: 32, r: 40, t: 14, b: 22 };
const BPM_MIN = 60;
const BPM_MAX = 180;

function avg(xs: (number | undefined)[]) {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}

/** Smooth path through points, skipping gaps (undefined). */
function path(pts: ({ x: number; y: number } | null)[]) {
  let d = "";
  let prev: { x: number; y: number } | null = null;
  for (const p of pts) {
    if (!p) { prev = null; continue; }
    if (!prev) d += `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    else {
      const cx = (prev.x + p.x) / 2;
      d += ` C${cx.toFixed(1)},${prev.y.toFixed(1)} ${cx.toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    prev = p;
  }
  return d;
}

export function EventEnergyRamp<K extends string>({
  sections,
  onSelect,
}: {
  sections: RampSection<K>[];
  onSelect?: (section: K, index: number) => void;
}) {
  const [show, setShow] = useState({ energy: true, dance: true, bpm: true });
  const [hover, setHover] = useState<number | null>(null);

  const flat = useMemo(
    () => sections.flatMap((s) => s.songs.map((song, i) => ({ song, sec: s.key, idx: i }))),
    [sections],
  );
  const n = flat.length;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y10 = (v: number) => PAD.t + innerH - (Math.min(10, Math.max(0, v)) / 10) * innerH;
  const yBpm = (v: number) => PAD.t + innerH - ((Math.min(BPM_MAX, Math.max(BPM_MIN, v)) - BPM_MIN) / (BPM_MAX - BPM_MIN)) * innerH;

  const ePts = flat.map((f, i) => (f.song.energy != null ? { x: x(i), y: y10(f.song.energy) } : null));
  const dPts = flat.map((f, i) => (f.song.danceability != null ? { x: x(i), y: y10(f.song.danceability) } : null));
  const bPts = flat.map((f, i) => (f.song.bpm ? { x: x(i), y: yBpm(f.song.bpm) } : null));

  let offset = 0;
  const bounds = sections.map((s) => {
    const start = offset;
    offset += s.songs.length;
    return {
      ...s,
      start,
      end: offset - 1,
      e: avg(s.songs.map((t) => t.energy)),
      d: avg(s.songs.map((t) => t.danceability)),
      b: avg(s.songs.map((t) => t.bpm)),
    };
  });

  if (n === 0) return null;
  const h = hover != null ? flat[hover] : null;
  const toggles = [
    { k: "energy" as const, label: "Energy", cls: "bg-primary" },
    { k: "dance" as const, label: "Danceability", cls: "bg-info" },
    { k: "bpm" as const, label: "BPM", cls: "bg-success" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event flow</h3>
          <p className="text-xs text-muted-foreground">{n} songs · Energy & danceability (1–10, left) · BPM ({BPM_MIN}–{BPM_MAX}, right)</p>
        </div>
        <div className="flex gap-1.5">
          {toggles.map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setShow((s) => ({ ...s, [t.k]: !s[t.k] }))}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${show[t.k] ? "border-border bg-secondary text-foreground" : "border-transparent text-muted-foreground opacity-60"}`}
            >
              <span className={`h-2 w-2 rounded-full ${t.cls}`} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - PAD.l) / innerW) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onClick={() => {
          if (hover != null && onSelect) onSelect(flat[hover].sec, flat[hover].idx);
        }}
        style={{ cursor: onSelect ? "pointer" : undefined }}
      >
        {[2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y10(v)} y2={y10(v)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={PAD.l - 6} y={y10(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{v}</text>
          </g>
        ))}
        {show.bpm && [80, 120, 160].map((v) => (
          <text key={v} x={W - PAD.r + 6} y={yBpm(v) + 3} fontSize="10" fill="var(--success)">{v}</text>
        ))}
        {bounds.slice(1).map((b) => (
          <line key={b.key} x1={x(b.start - 0.5)} x2={x(b.start - 0.5)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
        ))}
        {show.energy && (
          <>
            <path d={`${path(ePts)}`} fill="none" stroke="var(--primary)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {show.dance && <path d={path(dPts)} fill="none" stroke="var(--info)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
        {show.bpm && <path d={path(bPts)} fill="none" stroke="var(--success)" strokeWidth={1.5} strokeOpacity={0.85} vectorEffect="non-scaling-stroke" />}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--foreground)" strokeOpacity={0.4} vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      <div className="grid gap-2 border-t border-border pt-2" style={{ gridTemplateColumns: bounds.map((b) => `${Math.max(1, b.songs.length)}fr`).join(" ") }}>
        {bounds.map((b) => (
          <button key={b.key} type="button" onClick={() => onSelect?.(b.key, 0)} className="min-w-0 text-left text-xs">
            <div className="font-semibold text-foreground">{b.label} <span className="font-normal text-muted-foreground">· {b.songs.length} songs</span></div>
            <div className="text-muted-foreground">
              E {b.e?.toFixed(1) ?? "—"} · D {b.d?.toFixed(1) ?? "—"} · {b.b ? Math.round(b.b) : "—"} BPM
            </div>
          </button>
        ))}
      </div>

      <div className="mt-2 min-h-[1.25rem] text-xs text-muted-foreground">
        {h ? (
          <span>
            <span className="text-foreground">#{(hover ?? 0) + 1} {h.song.song}</span> — {h.song.artist} · Energy {h.song.energy ?? "—"} · Dance {h.song.danceability ?? "—"} · {h.song.bpm ? `${Math.round(h.song.bpm)} BPM` : "— BPM"}{h.song.key ? ` · ${h.song.key}` : ""}
            {onSelect ? " · click to open" : ""}
          </span>
        ) : (
          "Hover the chart to inspect a song."
        )}
      </div>
    </div>
  );
}
