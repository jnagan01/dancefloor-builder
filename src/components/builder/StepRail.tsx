import { Check } from "lucide-react";

export type StepDef = {
  id: number;
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
  return (
    <nav aria-label="Build steps">
      {/* Mobile: horizontal chips */}
      <ol className="flex gap-2 overflow-x-auto pb-2 lg:hidden">
        {steps.map((s) => {
          const active = s.id === current;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => !s.disabled && onSelect(s.id)}
                disabled={s.disabled}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                  active
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="font-mono tabular-nums">{s.id}</span>
                <span className="whitespace-nowrap">{s.label}</span>
                {s.done && <Check className="h-3 w-3 text-success" />}
              </button>
            </li>
          );
        })}
      </ol>

      {/* Desktop: vertical rail */}
      <ol className="hidden lg:block">
        {steps.map((s, i) => {
          const active = s.id === current;
          return (
            <li key={s.id} className="relative">
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[1.0625rem] top-9 h-[calc(100%-1.5rem)] w-px bg-border"
                />
              )}
              <button
                type="button"
                onClick={() => !s.disabled && onSelect(s.id)}
                disabled={s.disabled}
                aria-current={active ? "step" : undefined}
                className={`group grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors disabled:opacity-40 ${
                  active ? "bg-primary/10" : "hover:bg-accent/50"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : s.done
                        ? "border-success/50 bg-success/15 text-success"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {s.done && !active ? <Check className="h-3.5 w-3.5" /> : s.id}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm ${active ? "font-semibold text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
                  >
                    {s.label}
                  </span>
                  {s.hint && (
                    <span className="block truncate text-xs text-muted-foreground/80">{s.hint}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
