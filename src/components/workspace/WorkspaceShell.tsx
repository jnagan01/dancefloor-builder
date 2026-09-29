import { Link, useLocation } from "@tanstack/react-router";
import { Home, CalendarDays, Library, Settings, RefreshCw, Plus, Music2 } from "lucide-react";
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
  return <WorkspaceProvider><div className="min-h-dvh bg-background text-foreground lg:flex">
    <Toaster richColors position="top-right" />
    <aside className="app-drag desktop-titlebar-pad z-40 border-b border-sidebar-border bg-sidebar lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col px-4 py-5">
        <Link to="/" className="app-no-drag flex items-center gap-3 px-2 py-2 text-sidebar-foreground"><span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"><Music2 size={20} /></span><span className="font-display text-xl font-semibold">Dancefloor<br/>Builder</span></Link>
        <nav aria-label="Main navigation" className="app-no-drag mt-5 flex gap-1 overflow-x-auto lg:mt-10 lg:flex-col">
          {items.map(({to,label,icon: Icon}) => <Button asChild key={to} variant="ghost" className={`shrink-0 justify-start gap-3 ${pathname === to || (to === "/events" && pathname.startsWith("/events/")) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"}`}><Link to={to}><Icon size={17}/>{label}</Link></Button>)}
        </nav>
        <div className="app-no-drag mt-4 lg:mt-8"><Button asChild className="w-full justify-start gap-2"><Link to="/events/new"><Plus size={17}/> New event</Link></Button></div>
        <p className="hidden pt-6 text-xs text-muted-foreground lg:mt-auto lg:block">Dancefloor Builder v{APP_VERSION}</p>
      </div>
    </aside>
    <div className="min-w-0 flex-1 lg:ml-60"><main className="mx-auto w-full max-w-[1500px] px-4 py-7 sm:px-7 lg:px-10 lg:py-9">{children}</main><div className="px-4 pb-4 text-xs text-muted-foreground lg:hidden">v{APP_VERSION}</div></div>
  </div></WorkspaceProvider>;
}
