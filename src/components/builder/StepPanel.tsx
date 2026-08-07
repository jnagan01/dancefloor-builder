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
    <section className="panel-gold rounded-xl">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-border/70 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display-title mt-1.5 truncate text-2xl text-foreground sm:text-3xl">{title}</h2>
          {description && (
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}
