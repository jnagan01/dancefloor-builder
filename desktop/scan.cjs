const path = require("node:path");
const AUDIO_RE = /\.(mp3|m4a|wav|flac|ogg|aac|aiff?|wma|opus|alac)$/i;

/** No partial result is ever returned as a successful scan. Dependencies are injectable for tests. */
async function scanFolder(dirPath, { fs, tagCache, maxFiles = 200000 }) {
  if (typeof dirPath !== "string" || !dirPath.trim()) return { ok: false, complete: false, error: "No folder location saved." };
  const root = path.resolve(dirPath);
  const label = path.basename(root);
  const files = [];
  async function walk(dir) {
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) throw Object.assign(new Error("Not a directory"), { code: "ENOTDIR" });
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && AUDIO_RE.test(entry.name)) {
        if (files.length >= maxFiles) throw Object.assign(new Error("Scan limit exceeded"), { code: "MAX_FILES" });
        const fileStat = await fs.promises.stat(full);
        const tags = tagCache.get(full, fileStat);
        files.push({ name: entry.name, path: full, relativePath: path.join(label, path.relative(root, full)), size: fileStat.size, tags });
        if (files.length % 200 === 0) await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
  try {
    await walk(root);
    await tagCache.flush();
    return { ok: true, complete: true, root, label, files };
  } catch (error) {
    const code = error && error.code;
    const reason = code === "EACCES" || code === "EPERM"
      ? "macOS blocked access to part of this folder. Allow file access for SetArchitect in System Settings › Privacy & Security › Files and Folders."
      : code === "ENOENT" ? "The folder or a file disappeared during the scan. Reconnect the folder and try again."
      : code === "MAX_FILES" ? `This folder exceeds the ${maxFiles.toLocaleString()} audio-file scan limit. Choose smaller folders.`
      : `Couldn't finish reading that folder (${String(code || error)}).`;
    return { ok: false, complete: false, root, label, error: `${reason} Your saved music index has been kept.` };
  }
}
module.exports = { scanFolder };