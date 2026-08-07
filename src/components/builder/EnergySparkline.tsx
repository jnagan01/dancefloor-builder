export function EnergySparkline({
  values,
  className = "",
}: {
  values: number[];
  className?: string;
}) {
  const pts = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (pts.length < 2) return null;
  const w = 100;
  const h = 24;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const d = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Energy progression across this section"
      className={`h-6 w-full text-primary ${className}`}
    >
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="currentColor" opacity="0.12" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
