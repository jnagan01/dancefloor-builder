import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION, APP_BUILD_ID, formatBuildDate } from "@/lib/appVersion";
import { pageHead } from "@/lib/pageHead";
import { UpdateSettings } from "@/components/workspace/UpdateSettings";
import { checkPublishedBuild, describeResult, type WebVersionResult } from "@/lib/webVersion";

export const Route = createFileRoute("/_authenticated/updates")({
  component: UpdatesPage,
  head: () => pageHead("Check for updates", "Check the current SetArchitect web version and update status."),
});

function shortId(id: string | null) {
  return id ? id.slice(-8) : "unknown";
}

function UpdatesPage() {
  const [result, setResult] = useState<WebVersionResult | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function check() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = ++seqRef.current;
    setBusy(true);
    setResult(null);
    const next = await checkPublishedBuild({
      loadedBuildId: APP_BUILD_ID,
      origin: window.location.origin,
      signal: controller.signal,
    });
    if (seq !== seqRef.current || controller.signal.aborted) return;
    setResult(next);
    setCheckedAt(new Date().toISOString());
    setBusy(false);
  }

  const published = result && result.kind !== "unverified" ? result.published : null;

  return (
    <div className="max-w-3xl space-y-6">
      <header className="border-b border-border pb-5">
        <p className="text-xs font-semibold uppercase text-primary">Version</p>
        <h1 className="mt-2 font-display text-2xl sm:text-3xl">Check for updates</h1>
      </header>
      <UpdateSettings />
      <div className="grid gap-4 border-y border-border py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Loaded web version</p>
          <p className="mt-2 text-2xl font-semibold">v{APP_VERSION}</p>
          <p className="mt-1 text-sm text-muted-foreground">Built {formatBuildDate()}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">Build {shortId(APP_BUILD_ID)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Published web version</p>
          {published ? (
            <>
              <p className="mt-2 text-2xl font-semibold">v{published.version}</p>
              <p className="mt-1 text-sm text-muted-foreground">Built {formatBuildDate(published.buildTime)}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">Build {shortId(published.buildId)}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{busy ? "Checking…" : "Not checked yet"}</p>
          )}
          {checkedAt && <p className="mt-1 text-xs text-muted-foreground">Checked {formatBuildDate(checkedAt)}</p>}
        </div>
      </div>
      <Button size="sm" onClick={check} disabled={busy}>
        <RefreshCw size={16} className="mr-2" />
        {busy ? "Checking…" : "Check web version"}
      </Button>
      {result && <p role="status" className="text-sm">{describeResult(result)}</p>}
    </div>
  );
}
