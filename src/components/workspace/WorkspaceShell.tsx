import { Link, useLocation } from "@tanstack/react-router";
import { Home, CalendarDays, Library, Settings, RefreshCw, Plus } from "lucide-react";
import { APP_VERSION } from "@/lib/appVersion";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "./WorkspaceContext";
import type { ReactNode } from "react";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/updates", label: "Check for updates", icon: RefreshCw },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: l => l.pathname });
  const isActive = (to: string) =>
    pathname === to || (to === "/events" && pathname.startsWith("/events/"));

  return <WorkspaceProvider><div className="min-h-dvh bg-background text-foreground lg:flex">
    <Toaster richColors position="top-right" />
    <aside className="app-drag desktop-titlebar-pad glass z-40 border-b border-sidebar-border bg-sidebar/75 lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col px-3 py-4 lg:px-4 lg:py-6">
        <Link to="/" className="app-no-drag flex items-center gap-3 rounded-xl px-2 py-2 text-sidebar-foreground">
          <span className="h-7 w-1.5 rounded-full bg-primary" />
          <span className="font-display text-sm font-semibold leading-tight tracking-tight">Dancefloor<br/>Builder</span>
        </Link>
        <nav aria-label="Main navigation" className="app-no-drag mt-4 flex gap-1 overflow-x-auto lg:mt-8 lg:flex-col lg:overflow-visible">
          {items.map(({ to, label, icon: Icon }) => {
            const active = isActive(to);
            return <Button
              asChild
              key={to}
              variant="ghost"
              className={`h-9 shrink-0 justify-start gap-3 rounded-full px-3 text-sm transition-colors ${
                active
                  ? "bg-sidebar-accent/70 text-sidebar-accent-foreground [&_svg]:text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/35 hover:text-sidebar-foreground"
              }`}
            >
              <Link to={to}>
                <Icon size={16} />
                <span className="truncate">{label}</span>
                {active && <span aria-hidden className="ml-auto hidden size-1.5 rounded-full bg-primary lg:block" />}
              </Link>
            </Button>;
          })}
        </nav>
        <div className="app-no-drag mt-3 lg:mt-7">
          <Button asChild size="sm" className="w-full justify-start gap-2 rounded-full"><Link to="/events/new"><Plus size={16}/> New event</Link></Button>
        </div>
        <div className="hidden pt-4 text-[11px] text-muted-foreground lg:mt-auto lg:block">
          <p className="font-medium text-sidebar-foreground">Dancefloor Builder</p>
          <p className="mt-1">Version {APP_VERSION}</p>
        </div>
      </div>
    </aside>
    <div className="min-w-0 flex-1 lg:ml-60">
      <main className="workspace-main mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</main>
      <div className="px-4 pb-4 text-xs text-muted-foreground lg:hidden">v{APP_VERSION}</div>
    </div>
  </div></WorkspaceProvider>;
}
