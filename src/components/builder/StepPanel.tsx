import type { ReactNode } from "react";

export function StepPanel({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-border bg-card">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display-title mt-1.5 text-xl text-foreground sm:text-2xl">{title}</h2>
          {description && (
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}
