// Electron main for the preparation UI acceptance run. Fenced synthetic profile, loopback only.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const profile = process.env.SETARCHITECT_TEST_PROFILE, bundle = process.env.SETARCHITECT_TEST_BUNDLE;
if (!profile || !path.basename(profile).startsWith('setarchitect-native-prep-') || !fs.existsSync(path.join(profile, 'ISOLATED'))) throw Error('Separate synthetic profile required.');
app.setPath('userData', profile); app.setPath('downloads', profile); app.disableHardwareAcceleration();
const { createBackupStore } = require('../../../desktop/backups.cjs');
const backups = createBackupStore(profile);
const fixture = JSON.parse(fs.readFileSync(path.join(profile, 'fixture.json'), 'utf8'));
const blocked = [];
app.whenReady().then(() => {
  const server = http.createServer((req, res) => {
    const asset = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'app.js', 'app.css'].includes(asset)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(path.join(bundle, asset)));
  });
  const portFile = path.join(profile, 'port'); const port = fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, 'utf8')) : 0;
  server.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(portFile, String(server.address().port)); // same origin across restarts, so IndexedDB is the same store
    const origin = `http://127.0.0.1:${server.address().port}`;
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => { const ok = d.url.startsWith(origin + '/') || d.url.startsWith('devtools:') || d.url.startsWith('data:'); if (!ok) blocked.push(d.url); cb({ cancel: !ok }); });
    ipcMain.handle('prep:fixture', () => fixture);
    ipcMain.handle('prep:blocked', () => blocked);
    ipcMain.handle('prep:backup-save', (_e, raw, account) => { if (!account.startsWith('synthetic-')) throw Error('Real account blocked'); return backups.save(raw, account); });
    ipcMain.handle('prep:backup-latest', (_e, account) => { if (!account.startsWith('synthetic-')) throw Error('Real account blocked'); return backups.latest(account); });
    const win = new BrowserWindow({ width: 1280, height: 1000, show: true, webPreferences: { preload: path.join(__dirname, 'prep-preload.cjs'), contextIsolation: true, sandbox: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadURL(origin + '/');
  });
});
app.on('window-all-closed', () => app.quit());
