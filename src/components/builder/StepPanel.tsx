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
    <section className="panel px-5 py-5 sm:px-6 sm:py-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display-title mt-1.5 text-xl tracking-tight text-foreground sm:text-2xl">{title}</h2>
          {description && (
            <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="mt-5">{children}</div>
    </section>
  );
}
