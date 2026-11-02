// Test-only: preloaded into the REAL desktop/main.cjs to answer native dialogs.
// Refuses to run outside a fenced synthetic profile.
const fs = require("node:fs"), path = require("node:path");
const p = process.env.SETARCHITECT_TEST_USERDATA;
if (process.type === "browser") {
  if (!p || !path.basename(p).startsWith("setarchitect-offline-") || !fs.existsSync(path.join(p, "ISOLATED"))) throw Error("Fenced synthetic profile required.");
  const { dialog } = require("electron");
  dialog.showMessageBox = async (_w, o) => {
    const options = o || _w;
    fs.appendFileSync(path.join(p, "dialogs.log"), JSON.stringify(options.buttons) + "\n");
    const i = options.buttons.indexOf("Open Offline Workspace");
    return { response: i >= 0 ? i : options.cancelId ?? 0 };
  };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fs.readFileSync(path.join(p, "export-dir"), "utf8")] });
}
