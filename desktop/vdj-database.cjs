"use strict";
// Read-only access to VirtualDJ's database.xml. The file is never modified;
// malformed XML is recovered entry-by-entry in the renderer parser.
async function readVdjDatabaseFile(fs, target) {
  try {
    const xml = await fs.promises.readFile(target, "utf8");
    return { ok: true, path: target, xml };
  } catch (error) {
    const code = error && error.code;
    const message =
      code === "ENOENT"
        ? "No VirtualDJ database found at that location."
        : code === "EPERM" || code === "EACCES"
          ? "macOS blocked access to that folder. Allow file access for SetArchitect in System Settings › Privacy & Security › Files and Folders."
          : `Couldn't read the VirtualDJ database (${String(code || error)}).`;
    return { ok: false, path: target, error: message };
  }
}
module.exports = { readVdjDatabaseFile };
