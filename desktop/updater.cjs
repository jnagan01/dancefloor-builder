/* Signed GitHub ZIP updates. DMG remains only for first install / legacy bootstrap. */
const { app, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { createUpdateController } = require('./update-controller.cjs');
let buildInfo = null;
try { buildInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')); } catch {}
let controller;
async function preserve(parent) {
  const policy = require('./security.cjs').createDesktopSecurity(process.env.DANCEFLOOR_URL || 'https://dancefloor-builder.lovable.app', () => parent);
  if (!parent || !policy.trustedSender({ sender: parent.webContents, senderFrame: parent.webContents.mainFrame })) throw Error('Open the signed-in app before updating.');
  await parent.webContents.executeJavaScript(`(async()=>{if(typeof window.__setarchitectBeforeUpdate!=='function')throw Error('Current-state backup unavailable. Open the updated workspace before updating.');await window.__setarchitectBeforeUpdate();})()`);
}
async function release(parent) {
  if (parent && !parent.isDestroyed()) await parent.webContents.executeJavaScript(`window.__setarchitectReleaseUpdate?.()`);
}
function getController() {
  if (controller) return controller;
  if (process.platform !== 'darwin' || !app.isPackaged || !/^[\w.-]+\/[\w.-]+$/.test(buildInfo?.repository || '')) throw Error('Automatic Mac updates are available in signed release copies only.');
  const { MacUpdater } = require('electron-updater');
  const { CancellationToken } = require('builder-util-runtime');
  const semver = require('semver');
  const [owner, repo] = buildInfo.repository.split('/');
  const updater = new MacUpdater({ provider: 'github', owner, repo, private: false, releaseType: 'release' });
  controller = createUpdateController({ updater, currentVersion: app.getVersion(), newer: (a,b) => Boolean(semver.valid(a) && semver.valid(b) && semver.gt(a,b)), cancellation: () => new CancellationToken(), preserve: () => preserve(BrowserWindow.getAllWindows()[0]), release: () => release(BrowserWindow.getAllWindows()[0]), notify: state => { for (const win of BrowserWindow.getAllWindows()) { win.setProgressBar(state.phase === 'downloading' ? state.percent / 100 : -1); win.webContents.send('update:status', state); } } });
  return controller;
}
async function checkForUpdates({ silent = true } = {}) {
  const parent = BrowserWindow.getAllWindows()[0] || null;
  try {
    const c = getController();
    const state = await c.check();
    if (state.phase === 'available') {
      const { response } = await dialog.showMessageBox(parent, { type: 'info', title: 'Update available', message: `SetArchitect ${state.version} is available.`, detail: 'Download, preserve your current work, then install and restart automatically.', buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1 });
      if (response === 0) { const result = await c.install(); if (['failed','staging-failed'].includes(result.phase)) throw Error(result.error); }
    } else if (!silent && ['failed','current'].includes(state.phase)) {
      await dialog.showMessageBox(parent, { type: state.phase === 'failed' ? 'warning' : 'info', message: state.phase === 'failed' ? "Couldn't check for an update." : "You're running the latest version.", detail: state.error || `Installed: ${app.getVersion()}`, buttons: ['OK'] });
    }
  } catch (error) { if (!silent) await dialog.showMessageBox(parent, { type: 'error', message: 'Update stopped. Your work has not been discarded.', detail: error.message, buttons: ['OK'] }); }
}
// Real preservation, with only installer effects injected for isolated Electron checks.
async function runUpdate(_latest, parent, effects) {
  const { EventEmitter } = require('node:events');
  const updater = new EventEmitter(); updater.checkForUpdates = async () => ({ updateInfo: { version: '2.0.0' } });
  updater.downloadUpdate = () => effects.download(); updater.quitAndInstall = () => effects.open();
  const c = createUpdateController({ updater, currentVersion: '1.0.0', newer: () => true, cancellation: () => ({ cancelled: false, cancel() { this.cancelled = true; } }), preserve: () => preserve(parent), release: () => release(parent) });
  await c.check(); const result = await c.install();
  if (result.phase !== 'installing') await effects.message(parent, { message: result.error || 'Update stopped' });
  // Synthetic open is not a restart, so release the production renderer freeze.
  await release(parent);
  return result;
}
module.exports = { checkForUpdates, buildInfo, runUpdate, getController, updateBlocksQuit: () => controller?.blocksQuit() || false, updateBlocksNavigation: () => controller?.blocksNavigation() || false, updateInstallAuthorized: () => controller?.installAuthorized() || false };
