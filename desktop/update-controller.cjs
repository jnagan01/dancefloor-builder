/* Pinned electron-updater 6.6.2 public API. No Squirrel handoff until preservation succeeds. */
function createUpdateController({ updater, currentVersion, newer, cancellation, preserve, release, notify = () => {} }) {
  updater.autoDownload = false;
  // CRITICAL on Mac: false also prevents downloadUpdate from asking Squirrel to stage.
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  let state = { phase: "idle", percent: 0 }, active = null, token = null, authorized = false;
  const publish = (phase, detail = {}) => { state = { phase, percent: 0, ...detail }; notify({ ...state }); };
  updater.on("download-progress", progress => { if (state.phase === "downloading") publish("downloading", { percent: Math.max(0, Math.min(100, progress.percent)), version: state.version }); });
  updater.on("error", error => {
    // Once Squirrel is invoked it may have staged: never unlock editing/allow ordinary quit.
    if (state.phase === "installing") { authorized = false; publish("staging-failed", { error: error.message }); }
  });
  function once(operation) {
    if (active) return active;
    active = operation().finally(() => { active = null; });
    return active;
  }
  function check() {
    if (["installing", "staging-failed", "preservation-failed"].includes(state.phase)) return Promise.resolve({ ...state });
    return once(async () => {
      publish("checking");
      try {
        const result = await updater.checkForUpdates();
        const version = result?.updateInfo?.version;
        publish(version && newer(version, currentVersion) ? "available" : "current", { version });
      } catch (error) { publish("failed", { error: error.message }); }
      return { ...state };
    });
  }
  function install() {
    if (active) return active;
    if (state.phase !== "available" && state.phase !== "cancelled") return Promise.resolve({ ...state });
    return once(async () => {
      const version = state.version;
      if (!newer(version, currentVersion)) { publish("current"); return { ...state }; }
      token = cancellation();
      try {
        publish("downloading", { version });
        await updater.downloadUpdate(token);
        if (token.cancelled) { publish("cancelled", { version }); return { ...state }; }
        // Only now freeze UI, fsync the latest draft, and capture a FRESH account backup.
        publish("preserving", { version });
        await preserve();
        publish("installing", { version });
        authorized = true;
        updater.quitAndInstall(); // With autoInstallOnAppQuit=false this FIRST invokes Squirrel.
      } catch (error) {
        if (state.phase === "installing") { authorized = false; publish("staging-failed", { error: error.message }); }
        else {
          try { await release(); publish(token?.cancelled ? "cancelled" : "failed", { version, error: error.message }); }
          catch (unlockError) { publish("preservation-failed", { version, error: `Update stopped; editing remains locked: ${unlockError.message}` }); }
        }
      } finally { token = null; }
      return { ...state };
    });
  }
  return { check, install, status: () => ({ ...state }), cancel: () => { if (state.phase === "downloading") token?.cancel(); return { ...state }; },
    blocksQuit: () => !authorized && ["downloading", "preserving", "installing", "staging-failed", "preservation-failed"].includes(state.phase),
    blocksNavigation: () => ["preserving", "installing", "staging-failed", "preservation-failed"].includes(state.phase),
    installAuthorized: () => authorized && state.phase === "installing" };
}
module.exports = { createUpdateController };