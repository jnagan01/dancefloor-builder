/* Account-scoped offline copy + local recording-choice overlays.
 * Files live only below userData/offline. The active marker is the ONLY thing
 * that makes a cached account readable offline; signout/account change removes it.
 * Every write is temp+fsync+verify+rename; failures leave the last-good copy. */
const path = require("node:path"), crypto = require("node:crypto");
const { validate } = require("./backups.cjs");
const core = require("./offline/core.js");

const sha = v => crypto.createHash("sha256").update(String(v)).digest("hex");
const MAX_OVERLAY = 4 * 1024 * 1024;

function createOfflineStore(userData, fs = require("node:fs")) {
  const dir = path.join(userData, "offline");
  const activeFile = path.join(dir, "active.json");
  const snapFile = hash => path.join(dir, "snapshots", `${hash}.json`);
  const prevFile = hash => path.join(dir, "snapshots", `${hash}.prev.json`);
  const overlayFile = (hash, eventId, version) => path.join(dir, "overlays", hash, `${sha(eventId)}-${version}.json`);
  const accountOk = a => typeof a === "string" && a.length > 0 && a.length <= 200;

  async function atomicWrite(file, raw, check) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.promises.open(temp, "wx", 0o600);
      await handle.writeFile(raw, "utf8");
      await handle.sync();
      await handle.close(); handle = null;
      if (check) check(await fs.promises.readFile(temp, "utf8"));
      await fs.promises.rename(temp, file);
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(temp).catch(() => {});
      throw e;
    }
  }
  const readOrNull = async file => { try { return await fs.promises.readFile(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };

  function parseActive(raw) {
    const a = JSON.parse(raw);
    if (!a || a.version !== 1 || !/^[a-f0-9]{64}$/.test(a.account) || !Number.isFinite(Date.parse(a.preparedAt))) throw Error("Offline access marker is unreadable.");
    return a;
  }
  function parseSnapshot(raw, hash) {
    const wrapper = JSON.parse(raw);
    if (!wrapper || wrapper.version !== 1 || typeof wrapper.backup !== "string" || !Number.isFinite(Date.parse(wrapper.preparedAt))) throw Error("Offline copy is unreadable.");
    const inner = JSON.parse(wrapper.backup);
    if (!inner || sha(inner.account) !== hash) throw Error("Offline copy belongs to a different account.");
    return { preparedAt: wrapper.preparedAt, backup: validate(wrapper.backup, inner.account) };
  }

  /** Trusted, signed-in web origin only (caller enforces). raw is a full validated backup. */
  async function prepare(raw, account) {
    if (!accountOk(account)) throw Error("Sign in before preparing offline access.");
    const backup = validate(raw, account);
    const hash = sha(account), preparedAt = new Date().toISOString();
    const wrapper = JSON.stringify({ version: 1, preparedAt, backup: raw });
    const current = await readOrNull(snapFile(hash));
    // Keep the previous good copy as a fallback before replacing it.
    if (current !== null) { try { parseSnapshot(current, hash); await atomicWrite(prevFile(hash), current, r => parseSnapshot(r, hash)); } catch { /* corrupt current is never promoted to last-good */ } }
    await atomicWrite(snapFile(hash), wrapper, r => parseSnapshot(r, hash));
    await atomicWrite(activeFile, JSON.stringify({ version: 1, account: hash, preparedAt }), parseActive);
    return { ok: true, preparedAt, events: backup.events.length, tracks: backup.sources.reduce((n, s) => n + s.tracks.length, 0) };
  }

  async function invalidate() {
    try { await fs.promises.unlink(activeFile); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  /** Any different signed-in account immediately removes offline availability. */
  async function accountSeen(account) {
    if (!accountOk(account)) return invalidate();
    const raw = await readOrNull(activeFile);
    if (raw === null) return;
    let active; try { active = parseActive(raw); } catch { return invalidate(); }
    if (active.account !== sha(account)) await invalidate();
  }
  async function status(account) {
    if (!accountOk(account)) return { prepared: false };
    const raw = await readOrNull(activeFile);
    if (raw === null) return { prepared: false };
    const active = parseActive(raw);
    if (active.account !== sha(account)) return { prepared: false };
    const snap = parseSnapshot(await fs.promises.readFile(snapFile(active.account), "utf8"), active.account);
    return { prepared: true, preparedAt: snap.preparedAt, events: snap.backup.events.length, tracks: snap.backup.sources.reduce((n, s) => n + s.tracks.length, 0) };
  }

  /** Loads only the active account. Corrupt current copy falls back to last-good, labelled. */
  async function loadActive() {
    const raw = await readOrNull(activeFile);
    if (raw === null) return { state: "none" };
    let active;
    try { active = parseActive(raw); } catch { return { state: "corrupt", error: "Offline access marker is unreadable. Prepare offline access again while online." }; }
    let snap, fallback = false, problem = null;
    try { snap = parseSnapshot(await fs.promises.readFile(snapFile(active.account), "utf8"), active.account); }
    catch (e) {
      problem = e.message;
      try { snap = parseSnapshot(await fs.promises.readFile(prevFile(active.account), "utf8"), active.account); fallback = true; }
      catch { return { state: "corrupt", error: "The saved offline copy could not be read and no earlier copy is available. Nothing was changed. Prepare offline access again while online." }; }
    }
    return { state: "ready", hash: active.account, preparedAt: snap.preparedAt, fallback, problem, backup: snap.backup };
  }

  const eventVersion = event => sha(JSON.stringify(event.snapshot)).slice(0, 32);

  async function readOverlay(hash, eventId, version) {
    const raw = await readOrNull(overlayFile(hash, eventId, version));
    if (raw === null) return { selections: {} };
    const o = JSON.parse(raw);
    if (!o || o.version !== 1 || o.eventId !== eventId || o.snapshotVersion !== version || !o.selections || typeof o.selections !== "object" || Array.isArray(o.selections)) throw Error("Local offline choices for this event are unreadable. They were left untouched.");
    for (const [k, v] of Object.entries(o.selections)) if (!/^(warmUp|transition|peak):\d{1,4}$/.test(k) || !v || !Array.isArray(v.paths) || v.paths.length > 20 || v.paths.some(core.unsafePath) || v.confirmed !== true || !v.song) throw Error("Local offline choices for this event are unreadable. They were left untouched.");
    return o;
  }
  /** Counts overlays written against other (older) versions of the same event. */
  async function staleOverlayCount(hash, eventId, version) {
    let names; try { names = await fs.promises.readdir(path.join(dir, "overlays", hash)); } catch { return 0; }
    const prefix = `${sha(eventId)}-`;
    return names.filter(n => n.startsWith(prefix) && n.endsWith(".json") && n !== `${prefix}${version}.json`).length;
  }

  /** set: { section, index, path } explicit approval; or { section, index, clear:true }. */
  async function setChoice(hash, backup, eventId, change) {
    const event = backup.events.find(e => e.id === eventId);
    if (!event) throw Error("Event not in the offline copy.");
    const { section, index } = change || {};
    if (!["warmUp", "transition", "peak"].includes(section) || !Number.isInteger(index)) throw Error("Invalid song position.");
    const song = (event.snapshot.lists[section] || [])[index];
    if (!song) throw Error("Song not in this event.");
    const version = eventVersion(event);
    const overlay = await readOverlay(hash, eventId, version);
    const key = `${section}:${index}`;
    const next = { version: 1, eventId, snapshotVersion: version, selections: { ...overlay.selections } };
    if (change.clear) delete next.selections[key];
    else {
      const tracks = backup.sources.flatMap(s => s.tracks);
      if (typeof change.path !== "string" || !tracks.some(t => t.filePath === change.path)) throw Error("That recording is not in the saved library.");
      next.selections[key] = { paths: [change.path], confirmed: true, song: { artist: song.artist, song: song.song }, at: new Date().toISOString() };
    }
    const raw = JSON.stringify(next);
    if (Buffer.byteLength(raw) > MAX_OVERLAY) throw Error("Too many local choices.");
    await atomicWrite(overlayFile(hash, eventId, version), raw, r => { if (r !== raw) throw Error("Write verification failed."); });
    return next;
  }

  return { prepare, invalidate, accountSeen, status, loadActive, readOverlay, setChoice, eventVersion, staleOverlayCount, dir };
}
module.exports = { createOfflineStore };
