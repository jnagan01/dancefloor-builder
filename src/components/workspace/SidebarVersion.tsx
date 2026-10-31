import { useEffect, useState } from "react";
import { resolveSidebarVersion, VERSION_LOADING } from "@/lib/sidebarVersion";

export function SidebarVersion({ className }: { className?: string }) {
  const [label, setLabel] = useState(VERSION_LOADING);
  useEffect(() => {
    let active = true;
    const native = window as Window & {
      electronUpdates?: { status?: () => Promise<unknown> };
      electronFiles?: unknown;
      electronVirtualDJ?: unknown;
    };
    void resolveSidebarVersion({
      userAgent: navigator.userAgent,
      nativeBridge: Boolean(native.electronUpdates || native.electronFiles || native.electronVirtualDJ),
      status: native.electronUpdates?.status ? () => native.electronUpdates?.status?.() ?? Promise.resolve(null) : undefined,
    }).then(value => { if (active) setLabel(value); });
    return () => { active = false; };
  }, []);
  return <p className={className}>{label}</p>;
}