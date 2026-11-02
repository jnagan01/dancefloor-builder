/* Account-scoped offline copy + local recording-choice overlays.
 * Files live only below userData/offline. The active marker is the ONLY thing
 * that makes a cached account readable offline, and only while it carries the current
 * durable revocation epoch; signout/account change bumps the epoch and removes it.
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

  // Session fence. Revocation is synchronous at IPC entry and does not wait for any queued prepare:
  //  - in memory: generation++ and `revoked` make status/loadActive deny immediately (even for a newly opened window);
  //  - durably: a monotonically increasing epoch is fsynced before returning, and a marker is valid only if it
  //    carries the current epoch, so a marker published by an older prepare (or surviving a crash before cleanup)
  //    can never be resurrected. Cache files are kept; only availability is revoked.
  // A prepare requires a fresh accountSeen for the same account after any sign-out.
  const epochFile = path.join(dir, "epoch.json");
  let generation = 0, sessionHash = null, chain = Promise.resolve(), revoked = false, epoch = 0;
  try { const e = JSON.parse(fs.readFileSync(epochFile, "utf8")).epoch; if (Number.isSafeInteger(e) && e >= 0) epoch = e; else revoked = true; }
  catch (e) { if (e.code !== "ENOENT") revoked = true; } // unreadable fence: deny until prepared again
  const listeners = new Set();
  const serial = fn => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  function writeEpochSync(next) {
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${epochFile}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ epoch: next })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, epochFile); } catch (e) { try { fs.unlinkSync(temp); } catch { /* ignore */ } throw e; }
    try { const d = fs.openSync(dir, "r"); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* directory fsync unsupported */ }
  }
  const revoke = () => {
    generation++; revoked = true;
    for (const l of listeners) { try { l(); } catch { /* listener errors never block revocation */ } }
    let durable = false;
    try { writeEpochSync(epoch + 1); epoch++; durable = true; } catch { /* fall through to marker removal */ }
    try { fs.unlinkSync(activeFile); durable = true; } catch (e) { if (e.code === "ENOENT") durable = true; }
    if (!durable) throw Error("Offline access was hidden for now but could not be revoked on disk.");
  };
  const unlinkMarker = async () => { try { await fs.promises.unlink(activeFile); } catch (e) { if (e.code !== "ENOENT") throw e; } };
  const fenced = gen => { if (gen !== generation) throw Error("Account or session changed; offline access was not prepared."); };
  const markerValid = a => !revoked && (a.epoch === undefined ? 0 : a.epoch) === epoch;

  /** Trusted, signed-in web origin only (caller enforces). raw is a full validated backup. */
  function prepare(raw, account) {
    if (!accountOk(account)) return Promise.reject(Error("Sign in before preparing offline access."));
    const hash = sha(account);
    if (sessionHash !== hash) return Promise.reject(Error(sessionHash === null ? "Sign in again before preparing offline access." : "Account changed; offline access was not prepared."));
    let backup;
    try { backup = validate(raw, account); } catch (e) { return Promise.reject(e); }
    const gen = generation;
    return serial(async () => {
      fenced(gen);
      const myEpoch = epoch;
      const preparedAt = new Date().toISOString();
      const wrapper = JSON.stringify({ version: 1, preparedAt, backup: raw });
      const current = await readOrNull(snapFile(hash));
      fenced(gen);
      // Keep the previous good copy as a fallback before replacing it.
      if (current !== null) { try { parseSnapshot(current, hash); await atomicWrite(prevFile(hash), current, r => parseSnapshot(r, hash)); } catch { /* corrupt current is never promoted to last-good */ } }
      fenced(gen);
      await atomicWrite(snapFile(hash), wrapper, r => parseSnapshot(r, hash));
      fenced(gen);
      await atomicWrite(activeFile, JSON.stringify({ version: 1, account: hash, preparedAt, epoch: myEpoch }), parseActive);
      if (gen !== generation || myEpoch !== epoch) { await unlinkMarker().catch(() => {}); fenced(gen); throw Error("Account or session changed; offline access was not prepared."); }
      revoked = false;
      return { ok: true, preparedAt, events: backup.events.length, tracks: backup.sources.reduce((n, s) => n + s.tracks.length, 0) };
    });
  }

  function invalidate() {
    sessionHash = null;
    try { revoke(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve();
  }
  /** Any different signed-in account immediately revokes offline availability. */
  function accountSeen(account) {
    if (!accountOk(account)) return invalidate();
    const hash = sha(account);
    const changed = sessionHash !== null && sessionHash !== hash;
    sessionHash = hash;
    if (changed) { try { revoke(); } catch (e) { return Promise.reject(e); } }
    const gen = generation;
    return readOrNull(activeFile).then(raw => {
      if (raw === null || gen !== generation) return;
      let active; try { active = parseActive(raw); } catch { active = null; }
      if (!active || active.account !== hash) revoke();
    });
  }
  async function status(account) {
    if (!accountOk(account) || revoked) return { prepared: false };
    const gen = generation;
    const raw = await readOrNull(activeFile);
    if (raw === null || gen !== generation) return { prepared: false };
    const active = parseActive(raw);
    if (active.account !== sha(account) || !markerValid(active)) return { prepared: false };
    const snap = parseSnapshot(await fs.promises.readFile(snapFile(active.account), "utf8"), active.account);
    if (gen !== generation || revoked) return { prepared: false };
    return { prepared: true, preparedAt: snap.preparedAt, events: snap.backup.events.length, tracks: snap.backup.sources.reduce((n, s) => n + s.tracks.length, 0) };
  }

  /** Loads only the active account. Corrupt current copy falls back to last-good, labelled. */
  async function loadActive() {
    if (revoked) return { state: "none" };
    const gen = generation;
    const raw = await readOrNull(activeFile);
    if (raw === null || gen !== generation) return { state: "none" };
    let active;
    try { active = parseActive(raw); } catch { return { state: "corrupt", error: "Offline access marker is unreadable. Prepare offline access again while online." }; }
    if (!markerValid(active)) return { state: "none" };
    let snap, fallback = false, problem = null;
    try { snap = parseSnapshot(await fs.promises.readFile(snapFile(active.account), "utf8"), active.account); }
    catch (e) {
      problem = e.message;
      try { snap = parseSnapshot(await fs.promises.readFile(prevFile(active.account), "utf8"), active.account); fallback = true; }
      catch { return { state: "corrupt", error: "The saved offline copy could not be read and no earlier copy is available. Nothing was changed. Prepare offline access again while online." }; }
    }
    if (gen !== generation || revoked) return { state: "none" };
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
  async function setChoice(hash, backup, eventId, change, fence = () => {}) {
    const event = backup.events.find(e => e.id === eventId);
    if (!event) throw Error("Event not in the offline copy.");
    const { section, index } = change || {};
    if (!["warmUp", "transition", "peak"].includes(section) || !Number.isInteger(index)) throw Error("Invalid song position.");
    const song = (event.snapshot.lists[section] || [])[index];
    if (!song) throw Error("Song not in this event.");
    const version = eventVersion(event);
    const overlay = await readOverlay(hash, eventId, version);
    fence();
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
    fence();
    await atomicWrite(overlayFile(hash, eventId, version), raw, r => { if (r !== raw) throw Error("Write verification failed."); });
    return next;
  }

  return { prepare, invalidate, accountSeen, status, generation: () => generation, onRevoke: fn => { listeners.add(fn); return () => listeners.delete(fn); }, loadActive, readOverlay, setChoice, eventVersion, staleOverlayCount, dir };
}
module.exports = { createOfflineStore };
