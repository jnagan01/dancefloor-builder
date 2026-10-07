import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION, APP_BUILD_TIME, formatBuildDate } from "@/lib/appVersion";
import { pageHead } from "@/lib/pageHead";
export const Route = createFileRoute("/_authenticated/updates")({component:UpdatesPage,head:()=>pageHead("Check for updates","Check the current SetArchitect web version and update status.")});
function UpdatesPage(){const [status,setStatus]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 async function check(){setBusy(true);try{const response=await fetch(`${window.location.origin}/?update-check=${Date.now()}`,{cache:"no-store"});const html=await response.text();const match=html.match(/<meta[^>]+name="app-build-time"[^>]+content="([^"]+)"/);if(!response.ok||!match){setStatus("Could not verify the latest published version. Refresh the app to try again.")}else if(match[1]===APP_BUILD_TIME){setStatus("You’re up to date with the published web version.")}else{setStatus("A newer web version is available. Refresh the app to load it.")}}catch{setStatus("Could not check for updates. Check your connection and try again.")}finally{setBusy(false)}}
  return <div className="max-w-3xl space-y-6"><header className="border-b border-border pb-5"><p className="text-xs font-semibold uppercase text-primary">Version</p><h1 className="mt-2 font-display text-2xl sm:text-3xl">Check for updates</h1></header><div className="border-y border-border py-5"><p className="text-xs uppercase text-muted-foreground">Current web version</p><p className="mt-2 text-2xl font-semibold">v{APP_VERSION}</p><p className="mt-1 text-sm text-muted-foreground">Updated {formatBuildDate()}</p></div><Button size="sm" onClick={check} disabled={busy}><RefreshCw size={16} className="mr-2"/>{busy?"Checking…":"Check now"}</Button>{status&&<p role="status" className="text-sm">{status}</p>}<p className="text-xs text-muted-foreground">This checks published web updates. A new Mac installer is separate and is not installed automatically.</p></div>
}
