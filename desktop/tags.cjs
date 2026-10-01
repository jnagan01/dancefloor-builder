/* Reads and writes the real metadata tags inside music files (MP3, M4A, FLAC, WAV, AIFF, OGG). */
const path = require("node:path");
const fs = require("node:fs");

let taglib = null;
function lib() {
  if (!taglib) taglib = require("node-taglib-sharp");
  return taglib;
}

const clean = (v) => (typeof v === "string" ? v.replace(/\0/g, "").trim() : "");

function readTagsSync(filePath) {
  let file;
  try {
    file = lib().File.createFromPath(filePath);
    const t = file.tag;
    return {
      title: clean(t.title),
      artist: clean((t.performers || []).join(", ")) || clean((t.albumArtists || []).join(", ")),
      album: clean(t.album),
      genre: clean((t.genres || []).join(", ")),
      year: t.year ? String(t.year) : "",
      bpm: t.beatsPerMinute ? String(t.beatsPerMinute) : "",
      key: clean(t.initialKey),
      comment: clean(t.comment),
    };
  } catch {
    return null;
  } finally {
    try { file && file.dispose(); } catch { /* ignore */ }
  }
}

function createTagCache(userDataDir) {
  const cacheFile = path.join(userDataDir, "tag-cache.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")) || {}; } catch { cache = {}; }
  let dirty = false;
  return {
    /** Returns tags for a file, re-reading only when the file changed. */
    get(filePath, stat) {
      const sig = `${stat.size}:${Math.round(stat.mtimeMs)}`;
      const hit = cache[filePath];
      if (hit && hit.sig === sig) return hit.tags;
      const tags = readTagsSync(filePath);
      cache[filePath] = { sig, tags };
      dirty = true;
      return tags;
    },
    forget(filePath) { delete cache[filePath]; dirty = true; },
    async flush() {
      if (!dirty) return;
      dirty = false;
      try { await fs.promises.writeFile(cacheFile, JSON.stringify(cache)); } catch { /* ignore */ }
    },
  };
}

const MAX = 500;
const str = (v) => (typeof v === "string" ? v.slice(0, MAX).trim() : undefined);

/** Writes edited tags back into the file, keeping a backup of the old values first. */
async function writeTags(userDataDir, filePath, patch) {
  if (typeof filePath !== "string" || !filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: "That music file couldn't be found on this Mac." };
  }
  const before = readTagsSync(filePath);
  if (!before) return { ok: false, error: "This file type can't be edited." };
  try {
    await fs.promises.appendFile(
      path.join(userDataDir, "tag-backups.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), filePath, before }) + "\n",
    );
  } catch { /* backup is best-effort */ }
  let file;
  try {
    file = lib().File.createFromPath(filePath);
    const t = file.tag;
    const p = patch || {};
    if (str(p.title) !== undefined) t.title = str(p.title);
    if (str(p.artist) !== undefined) t.performers = str(p.artist) ? [str(p.artist)] : [];
    if (str(p.album) !== undefined) t.album = str(p.album);
    if (str(p.genre) !== undefined) t.genres = str(p.genre) ? [str(p.genre)] : [];
    if (str(p.comment) !== undefined) t.comment = str(p.comment);
    if (str(p.key) !== undefined) t.initialKey = str(p.key);
    if (str(p.year) !== undefined) {
      const y = parseInt(str(p.year), 10);
      t.year = Number.isFinite(y) && y > 0 && y < 10000 ? y : 0;
    }
    if (str(p.bpm) !== undefined) {
      const b = Math.round(parseFloat(str(p.bpm)));
      t.beatsPerMinute = Number.isFinite(b) && b > 0 && b < 1000 ? b : 0;
    }
    file.save();
  } catch (error) {
    const code = error && error.code;
    return {
      ok: false,
      error: code === "EPERM" || code === "EACCES"
        ? "macOS blocked changes to that file. Check the file isn't locked and that Dancefloor Builder has folder access."
        : "Couldn't save the changes to that file.",
    };
  } finally {
    try { file && file.dispose(); } catch { /* ignore */ }
  }
  return { ok: true, tags: readTagsSync(filePath) };
}

module.exports = { readTagsSync, createTagCache, writeTags };
