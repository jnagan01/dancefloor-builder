type UpdateHost = Window & {
  __setarchitectPreserveEvent?: () => void;
  __setarchitectReleaseUpdate?: () => void;
  electronUpdates?: { subscribe: (callback: (state: { phase: string; error?: string }) => void) => () => void };
};
/** Freeze editing after download, before the fresh backup and Squirrel staging. */
export function lockUpdateEditing() {
  const host = window as UpdateHost;
  if (document.getElementById("update-preservation-lock")) throw Error("An update is already being prepared.");
  host.__setarchitectPreserveEvent?.();
  const affected = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
  const previous = affected.map(node => node.inert);
  affected.forEach(node => { node.inert = true; });
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLElement && node.id !== "update-preservation-lock" && !affected.includes(node)) { affected.push(node); previous.push(node.inert); node.inert = true; }
    }
  });
  observer.observe(document.body, { childList: true });
  const cover = document.createElement("div");
  cover.id = "update-preservation-lock"; cover.className = "update-preservation-lock";
  cover.setAttribute("role", "status"); cover.textContent = "Preserving your work before restarting…";
  document.body.append(cover);
  const unsubscribe = host.electronUpdates?.subscribe(state => {
    if (state.phase !== "staging-failed" && state.phase !== "preservation-failed") return;
    cover.setAttribute("role", "alert");
    cover.textContent = state.phase === "staging-failed"
      ? `Update could not finish. Installation status is uncertain, so editing and normal quitting remain blocked. Your pre-install backup and draft were preserved. Keep this window open; do not force quit, restart, or reinstall until installation status is checked and recovery from the preserved copies is arranged. Error: ${state.error || "Unknown installation error"}`
      : `Update stopped and editing could not be safely unlocked. Keep this window open; do not force quit or restart. Check the preservation error and recover your work before attempting another update. Error: ${state.error || "Unknown preservation error"}`;
  });
  const release = () => { unsubscribe?.(); observer.disconnect(); affected.forEach((node, i) => { node.inert = previous[i]; }); cover.remove(); if (host.__setarchitectReleaseUpdate === release) delete host.__setarchitectReleaseUpdate; };
  host.__setarchitectReleaseUpdate = release;
  return { release, checkpoint: () => host.__setarchitectPreserveEvent?.() };
}