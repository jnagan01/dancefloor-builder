/* Dancefloor Builder — checks GitHub Releases for a newer Mac build. */
const { app, dialog, shell, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");

let buildInfo = null;
try {
  buildInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
} catch {
  buildInfo = null; // running from source, or built without release info
}

const UA = { "User-Agent": "DancefloorBuilder-Updater", Accept: "application/vnd.github+json" };

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: UA }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return resolve(getJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GitHub returned ${res.statusCode}`));
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: UA }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return resolve(download(res.headers.location, destination));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed (${res.statusCode})`));
        }
        const file = fs.createWriteStream(destination);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destination)));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchLatest() {
  if (!buildInfo || !buildInfo.repository) return null;
  const release = await getJson(
    `https://api.github.com/repos/${buildInfo.repository}/releases/latest`,
  );
  if (!release || !release.tag_name) return null;
  const asset = (release.assets || []).find((a) => /\.dmg$/i.test(a.name || ""));
  return {
    tag: release.tag_name,
    name: release.name || release.tag_name,
    url: asset && asset.browser_download_url,
    assetName: asset && asset.name,
    isNewer: release.tag_name !== buildInfo.tag,
  };
}

async function runUpdate(latest, parent) {
  const target = path.join(app.getPath("downloads"), latest.assetName || "DancefloorBuilder.dmg");
  try {
    await download(latest.url, target);
  } catch (error) {
    await dialog.showMessageBox(parent, {
      type: "error",
      title: "Download failed",
      message: "The new version couldn't be downloaded.",
      detail: String((error && error.message) || error),
      buttons: ["OK"],
    });
    return;
  }
  await shell.openPath(target);
  await dialog.showMessageBox(parent, {
    type: "info",
    title: "Almost there",
    message: "The new version has been downloaded and opened.",
    detail:
      "Drag Dancefloor Builder into your Applications folder, replace the old one, then quit and reopen the app.",
    buttons: ["OK"],
  });
}

async function checkForUpdates({ silent = true } = {}) {
  const parent = BrowserWindow.getAllWindows()[0] || null;
  if (!buildInfo || !buildInfo.repository) {
    if (!silent) {
      await dialog.showMessageBox(parent, {
        type: "info",
        title: "Check for updates",
        message: "Automatic updates aren't available in this copy of the app.",
        detail: "Install a build from the download page to get update notifications.",
        buttons: ["OK"],
      });
    }
    return;
  }

  let latest = null;
  try {
    latest = await fetchLatest();
  } catch (error) {
    if (!silent) {
      await dialog.showMessageBox(parent, {
        type: "warning",
        title: "Check for updates",
        message: "Couldn't check for a new version.",
        detail: String((error && error.message) || error),
        buttons: ["OK"],
      });
    }
    return;
  }

  if (!latest || !latest.isNewer || !latest.url) {
    if (!silent) {
      await dialog.showMessageBox(parent, {
        type: "info",
        title: "Check for updates",
        message: "You're running the latest version.",
        detail: `Installed: ${buildInfo.tag || app.getVersion()}`,
        buttons: ["OK"],
      });
    }
    return;
  }

  const { response } = await dialog.showMessageBox(parent, {
    type: "info",
    title: "Update available",
    message: `A new version of Dancefloor Builder is available (${latest.name}).`,
    detail: "It will download to your Downloads folder and open automatically.",
    buttons: ["Update now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await runUpdate(latest, parent);
}

module.exports = { checkForUpdates, buildInfo };
