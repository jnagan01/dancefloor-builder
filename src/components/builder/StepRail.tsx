import { Check } from "lucide-react";

export type StepDef = {
  id: number;
  /** Number shown in the circle; defaults to `id`. Lets a flow skip a step
   *  (cocktail/dinner skip song expansion) without gaps in the numbering. */
  num?: number;
  label: string;
  hint?: string;
  done?: boolean;
  disabled?: boolean;
};


export function StepRail({
  steps,
  current,
  onSelect,
}: {
  steps: StepDef[];
  current: number;
  onSelect: (id: number) => void;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <nav aria-label="Build steps" className="panel glass px-2 py-2">
      <ol className="flex items-stretch gap-1 overflow-x-auto">
        {steps.map((s) => {
          const active = s.id === current;
          return (
            <li key={s.id} className="min-w-0 shrink-0 lg:flex-1">
              <button
                type="button"
                onClick={() => !s.disabled && onSelect(s.id)}
                disabled={s.disabled}
                aria-current={active ? "step" : undefined}
                className={`flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 ${
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : s.done
                        ? "bg-success/20 text-success"
                        : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {s.done && !active ? <Check className="size-3" /> : s.id}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate ${active ? "font-semibold" : ""}`}>{s.label}</span>
                  {s.hint && active && (
                    <span className="block truncate text-[11px] text-muted-foreground">{s.hint}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mx-2 mt-2 h-px overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </nav>
  );
}
