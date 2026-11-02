// Real preparation-UI acceptance in a fenced synthetic Electron profile (network denied except loopback).
import { build } from 'esbuild'; import { _electron as electron, expect } from '@playwright/test';
import { compile } from '@tailwindcss/node'; import { Scanner } from '@tailwindcss/oxide';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'setarchitect-native-prep-')), bundle = path.join(temp, 'bundle');
fs.mkdirSync(bundle); fs.writeFileSync(path.join(temp, 'ISOLATED'), 'synthetic only');
const stub = path.join(root, 'tests/native/fixtures/prep-services.tsx');
const stubbed = ['@/lib/prep/lookup.functions', '@/lib/lastfm.functions', '@tanstack/react-router', '@tanstack/react-start', '@/lib/pageHead', 'sonner', '@/components/workspace/WaveformPlayer', '@/components/workspace/TrackTagEditor', '@/lib/audioMatch'];
await build({ entryPoints: [path.join(root, 'tests/native/fixtures/prep-entry.tsx')], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: path.join(bundle, 'app.js'), jsx: 'automatic', alias: { '@': path.join(root, 'src') }, logLevel: 'error',
  plugins: [{ name: 'isolated', setup(b) { b.onResolve({ filter: /.*/ }, a => { if (stubbed.includes(a.path) || /(^|\/)WorkspaceContext$/.test(a.path) || /(^|\/)WaveformPlayer$/.test(a.path)) return { path: stub }; }); } }] });
const css = await compile(fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8'), { base: path.join(root, 'src'), onDependency: () => {} });
fs.writeFileSync(path.join(bundle, 'app.css'), css.build(new Scanner({ sources: [{ base: root, pattern: 'src/**/*.{tsx,ts}', negated: false }] }).scan()));
fs.writeFileSync(path.join(bundle, 'index.html'), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module">window.__fixture=await window.prepNative.fixture();await import('/app.js');</script>`);
const T = p => `/synthetic/Music/${p}`;
const tracks = [
  { filePath: T('a/Song.mp3'), artist: 'Queen', title: 'Song A', genre: 'Rock', bpm: '120', songLength: '200', year: '1980', playCount: 3 },
  { filePath: T('b/Song.mp3'), artist: 'Queen', title: 'Song A', remix: 'Club Remix', genre: 'Dance', bpm: '128', songLength: '420', year: '1999', playCount: 0 },
  { filePath: T('Hit (Clean Edit).mp3'), artist: 'Band', title: 'Hit (Clean Edit)', genre: 'Pop', bpm: '100', playCount: 0 },
  { filePath: T('Hit.mp3'), artist: 'Band', title: 'Hit', genre: 'Pop', bpm: '101', songLength: '180', playCount: 40 },
  { filePath: T('unknown.mp3'), artist: 'Other', title: 'Unknown', playCount: 0 },
  { filePath: T('Song B.mp3'), artist: 'Queen', title: 'Song B', genre: 'Rock', bpm: '118', songLength: '210', year: '1981', playCount: 0 },
  { filePath: T('deep.mp3'), artist: 'Discovery Artist', title: 'Deep Cut', genre: 'Indie', bpm: '110', playCount: 0 },
  { filePath: T('classic.mp3'), artist: 'Familiar Act', title: 'Classic', genre: 'Indie', bpm: '115', playCount: 90 },
];
const writeFixture = extra => fs.writeFileSync(path.join(temp, 'fixture.json'), JSON.stringify({ tracks, ...extra }));
const diagnostics = path.join(root, 'test-results/native/prep'); fs.mkdirSync(diagnostics, { recursive: true });
let app, page, count = 0; const errors = [];
async function launch(extra = {}) {
  writeFixture(extra);
  app = await electron.launch({ executablePath: process.env.ELECTRON_BIN || path.join(root, 'desktop/node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'), args: [path.join(root, 'tests/native/fixtures/prep-main.cjs'), '--no-sandbox'], env: { ...process.env, SETARCHITECT_TEST_PROFILE: temp, SETARCHITECT_TEST_BUNDLE: bundle } });
  page = await app.firstWindow(); page.on('pageerror', e => { errors.push(e.message); console.error('PAGE', e.message); });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('button', { name: 'Go library' }).waitFor({ timeout: 20000 });
}
async function close() { await app?.close().catch(() => {}); app = null; }
async function check(name, f) { await f(); count++; await page.screenshot({ path: path.join(diagnostics, `${String(count).padStart(2, '0')}-${name.replace(/\W+/g, '-').slice(0, 60)}.png`) }); console.log(`PASS ${name}`); }
const toasts = () => page.evaluate(() => window.__toasts);
const sheet = () => page.getByRole('dialog');
const prepTab = name => page.getByRole('region', { name: 'Event preparation' }).getByRole('tab', { name });
const narrow = async label => { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150); const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); await page.screenshot({ path: path.join(diagnostics, `narrow-${label}.png`) }); await page.setViewportSize({ width: 1280, height: 1000 }); if (!ok) throw Error(`Horizontal overflow at 390px on ${label}`); };

try {
  await launch();
  await check('VirtualDJ SongLength parsed by real DOMParser in Electron', async () => {
    const r = await page.evaluate(() => window.__parseVdj(`<VirtualDJ_Database><Song FilePath="/x/a.mp3"><Tags Author="A" Title="T"/><Infos SongLength="215.6"/></Song><Song FilePath="/x/b.mp3"><Tags Author="B" Title="U"/><Infos SongLength="nope"/></Song></VirtualDJ_Database>`));
    expect(r.map(t => t.songLength ?? null)).toEqual(['216', null]);
  });

  await check('library filters combine with explicit unknowns, save preset, persist across reload', async () => {
    await page.getByRole('button', { name: /^Filters/ }).click();
    const panel = page.getByRole('region', { name: 'Filters' });
    await panel.getByLabel('BPM minimum').fill('100'); await panel.getByLabel('BPM maximum').fill('125'); await panel.getByLabel('BPM maximum').blur();
    await expect(page.locator('tbody tr')).toHaveCount(7); // unknown BPM kept by default
    await panel.getByLabel('BPM: unknown values').selectOption('exclude');
    await expect(page.locator('tbody tr')).toHaveCount(6);
    await panel.locator('label', { hasText: 'Rock' }).getByRole('checkbox').check();
    await expect(page.locator('tbody tr')).toHaveCount(2); // Rock ∧ 100–125 BPM
    await expect(panel.getByRole('button', { name: /Remove filter/ })).toHaveCount(2); // BPM range+unknown mode, genre
    await panel.getByLabel('Saved filter name').fill('Rock mid tempo');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Rock mid tempo', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Reset all' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(8);
    await panel.getByRole('button', { name: 'Rock mid tempo', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.reload(); await page.getByRole('button', { name: 'Go library' }).waitFor();
    await expect(page.locator('tbody tr')).toHaveCount(2); // last filter remembered for this account
    await expect(page.getByRole('region', { name: 'Filters' }).getByRole('button', { name: 'Rock mid tempo', exact: true })).toBeVisible();
    await page.getByRole('region', { name: 'Filters' }).getByRole('button', { name: 'Reset all' }).click();
    await narrow('library-filters');
  });

  await check('preset rename/delete and account isolation', async () => {
    const panel = page.getByRole('region', { name: 'Filters' });
    await panel.getByRole('button', { name: 'Rename Rock mid tempo' }).click();
    await panel.getByLabel('New name for Rock mid tempo').fill('Rock renamed');
    await panel.getByRole('button', { name: 'Save name' }).click();
    await expect(panel.getByRole('button', { name: 'Rock renamed', exact: true })).toBeVisible();
    await page.evaluate(() => window.__switchAccount('synthetic-b'));
    await expect(page.getByRole('region', { name: 'Filters' }).getByRole('button', { name: 'Rock renamed', exact: true })).toHaveCount(0);
    await page.evaluate(() => window.__switchAccount('synthetic-a'));
    await expect(page.getByRole('region', { name: 'Filters' }).getByRole('button', { name: 'Rock renamed', exact: true })).toBeVisible();
  });

  await check('detail sheet binds exact duplicate-basename file, versions, preview', async () => {
    const row = page.locator('tbody tr', { hasText: 'b/Song.mp3' });
    await row.getByRole('button', { name: /Details for Song A/ }).click();
    await expect(sheet().getByTestId('detail-exact-file')).toHaveText(T('b/Song.mp3'));
    await expect(sheet().getByRole('region', { name: 'Version comparison' })).toContainText('Club Remix');
    await expect(sheet().getByText('Different files are different tracks')).toBeVisible();
    await sheet().getByRole('button', { name: 'Preview waveform' }).click();
    expect((await page.evaluate(() => window.__previews)).at(-1).filePath).toBe(T('b/Song.mp3'));
    await narrow('detail-sheet');
  });

  await check('tags save while typing a note never loses the note; explicit saves; reopen persistence', async () => {
    await page.evaluate(() => { window.__lookup.mbDelay = 50; });
    await sheet().getByLabel('Tags, comma separated').fill('First Dance, singalong');
    await sheet().getByRole('button', { name: 'Save tags' }).click();
    await sheet().getByLabel('Personal note').fill('Play right after speeches'); // typed while tags save resolves
    await expect(sheet().getByLabel('Tags save status')).toHaveText('Saved');
    await expect(sheet().getByLabel('Personal note')).toHaveValue('Play right after speeches');
    await expect(sheet().getByLabel('Note save status')).toHaveText('Unsaved changes');
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: 'b/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await expect(sheet().getByLabel('Personal note')).toHaveValue('Play right after speeches'); // draft survives close
    await sheet().getByRole('button', { name: 'Save note' }).click();
    await expect(sheet().getByLabel('Note save status')).toHaveText('Saved');
    await expect(sheet().getByLabel('Tags, comma separated')).toHaveValue('first dance, singalong');
    await page.keyboard.press('Escape');
    // The other file with the same basename has no notes.
    await page.locator('tbody tr', { hasText: 'a/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await expect(sheet().getByLabel('Tags, comma separated')).toHaveValue('');
    await page.keyboard.press('Escape');
  });

  await check('groups: create from details, add another track', async () => {
    await page.locator('tbody tr', { hasText: 'b/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await sheet().getByLabel('New group name').fill('Wedding singalongs');
    await sheet().getByRole('button', { name: 'Create group' }).click();
    await expect(sheet().getByLabel('Add to group')).toContainText('Wedding singalongs');
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: 'Song B.mp3' }).getByRole('button', { name: /Details for Song B/ }).click();
    await sheet().getByLabel('Add to group').selectOption({ label: 'Wedding singalongs' });
    await expect(sheet().getByLabel('Add to group')).toContainText('Wedding singalongs ✓');
    await page.keyboard.press('Escape');
  });

  await check('overlapping MusicBrainz + Last.fm lookups both finish; subject switch and close discard late results', async () => {
    await page.evaluate(() => { window.__lookup.mbDelay = 900; window.__lookup.lfDelay = 200; });
    await page.locator('tbody tr', { hasText: 'Song B.mp3' }).getByRole('button', { name: /Details for Song B/ }).click();
    await sheet().getByRole('button', { name: 'MusicBrainz', exact: true }).click();
    await sheet().getByRole('button', { name: 'Last.fm tags & similar' }).click();
    await expect(sheet().getByLabel('Last.fm results')).toContainText('lf-song-b');
    await expect(sheet().getByLabel('MusicBrainz results')).toBeVisible({ timeout: 5000 });
    await expect(sheet().getByRole('button', { name: 'MusicBrainz', exact: true })).toBeEnabled();
    await expect(sheet().getByRole('button', { name: 'Last.fm tags & similar' })).toBeEnabled();
    await expect(sheet().getByLabel('MusicBrainz results')).toContainText('Different version words');
    await sheet().getByLabel('MusicBrainz results').getByRole('button', { name: 'Keep as reference' }).first().click();
    await expect(sheet().getByText('Saved references')).toBeVisible();
    // Start slow lookups then switch to a different exact file of the same song: late results must not appear.
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: 'a/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await sheet().getByRole('button', { name: 'MusicBrainz', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: 'b/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await page.waitForTimeout(1200);
    await expect(sheet().getByLabel('MusicBrainz results')).toHaveCount(0);
    await expect(sheet().getByRole('button', { name: 'MusicBrainz', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  await page.getByRole('button', { name: 'Go event' }).click();
  await check('dashboard categories and drilldown follow export semantics', async () => {
    const region = page.getByRole('region', { name: 'Event preparation' });
    await expect(region).toContainText('1 confirmed tracks');
    await region.getByRole('button', { name: /No track linked/ }).click();
    await region.getByRole('button', { name: /Ghost – Missing/ }).click();
    expect(await page.evaluate(() => window.__jumps.at(-1))).toBe('warmUp:2');
    await expect(region.getByRole('button', { name: /Excluded from DJ export\s*1/ })).toBeVisible();
    await expect(region.getByRole('button', { name: /Waiting for your approval\s*1/ })).toBeVisible();
    await expect(region.getByRole('button', { name: /Alternate versions to compare\s*1/ })).toBeVisible();
    await expect(region).toContainText('≈'); // unknown lengths produce a labelled estimate
    await expect(region).toContainText('Estimate:');
    await narrow('dashboard');
  });

  await check('event-row details show the selected file per event', async () => {
    await page.getByRole('button', { name: 'Row details Song A' }).click();
    await expect(sheet().getByTestId('detail-exact-file')).toHaveText(T('a/Song.mp3'));
    await expect(sheet()).toContainText('Confirmed track');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open event E2' }).click();
    await page.getByRole('button', { name: 'Row details Song A' }).click();
    await expect(sheet().getByTestId('detail-exact-file')).toHaveText(T('b/Song.mp3'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open event E1' }).click();
  });

  await check('recommendation controls change ranking with evidence; event tags; dismiss scope + undo', async () => {
    await prepTab('Recommendations').click();
    const region = page.getByRole('region', { name: 'Event preparation' });
    const first = () => region.locator('ul > li').first();
    await expect(first()).toContainText('Queen – Song B'); // same artist as client request
    await expect(first()).toContainText('Same artist as client request');
    // Familiar: push slider fully right with keyboard
    const fam = region.getByRole('slider', { name: 'Discovery to familiar' });
    await fam.focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    const sim = region.getByRole('slider', { name: 'Similarity to client requests' });
    await sim.focus(); for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    await expect(first()).toContainText('Familiar Act – Classic');
    await expect(first()).toContainText('your familiarity, not crowd data');
    await sim.focus(); for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    await fam.focus(); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    // Personal tags: the tagged file (Song A remix) is in "Your tags" list; choose it for this event.
    await region.getByRole('button', { name: 'singalong' }).click();
    await expect(region.getByRole('button', { name: 'singalong' })).toHaveAttribute('aria-pressed', 'true');
    // Last.fm similar (stubbed) adds evidence; event switch mid-flight discards it.
    await page.evaluate(() => { window.__lookup.crowdDelay = 50; window.__lookup.similarArtist = 'Discovery Artist'; });
    await region.getByRole('button', { name: 'Add Last.fm similar artists' }).click();
    await expect(region).toContainText('Last.fm lists Discovery Artist as similar to Queen');
    // Dismiss here vs never
    const songB = region.locator('ul > li', { hasText: 'Queen – Song B' });
    await songB.getByRole('button', { name: 'Dismiss here' }).click();
    await expect(region.locator('ul > li', { hasText: 'Queen – Song B' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open event E2' }).click();
    await prepTab('Recommendations').click();
    await expect(page.getByRole('region', { name: 'Event preparation' }).locator('ul > li', { hasText: 'Queen – Song B' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Open event E1' }).click();
    await prepTab('Recommendations').click();
    const r2 = page.getByRole('region', { name: 'Event preparation' });
    await r2.getByText('Manage hidden songs').click();
    await r2.getByRole('button', { name: 'Undo' }).first().click();
    await expect(r2.locator('ul > li', { hasText: 'Queen – Song B' })).toHaveCount(1);
    await r2.locator('ul > li', { hasText: 'Familiar Act – Classic' }).getByRole('button', { name: 'Never' }).click();
    await page.getByRole('button', { name: 'Open event E2' }).click(); await prepTab('Recommendations').click();
    await expect(page.getByRole('region', { name: 'Event preparation' }).locator('ul > li', { hasText: 'Familiar Act – Classic' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open event E1' }).click();
    await narrow('recommendations');
  });

  await check('Last.fm similar result is discarded after switching event mid-request', async () => {
    await prepTab('Recommendations').click();
    await page.evaluate(() => { window.__lookup.crowdDelay = 800; window.__lookup.similarArtist = 'Late Artist'; });
    await page.getByRole('region', { name: 'Event preparation' }).getByRole('button', { name: 'Add Last.fm similar artists' }).click();
    await page.getByRole('button', { name: 'Open event E2' }).click();
    await prepTab('Recommendations').click();
    await page.waitForTimeout(1100);
    await expect(page.getByRole('region', { name: 'Event preparation' })).not.toContainText('Late Artist');
    await expect(page.getByRole('region', { name: 'Event preparation' }).getByRole('button', { name: 'Add Last.fm similar artists' })).toBeEnabled();
    await page.getByRole('button', { name: 'Open event E1' }).click();
  });

  await check('shortlist: add, dedupe, status, link exact file, add-to-section stays unapproved, group copy', async () => {
    await prepTab(/Shortlist/).click();
    const region = page.getByRole('region', { name: 'Event preparation' });
    await region.getByLabel('Shortlist artist').fill('Band'); await region.getByLabel('Shortlist title').fill('Hit'); await region.getByLabel('Desired version', { exact: true }).fill('clean edit');
    await region.getByRole('button', { name: 'Add', exact: true }).click();
    await region.getByLabel('Shortlist artist').fill('band'); await region.getByLabel('Shortlist title').fill('hit'); await region.getByLabel('Desired version', { exact: true }).fill('clean edit');
    await region.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(region.getByRole('status')).toContainText('Already on the shortlist');
    await region.getByLabel('Status for Band – Hit').selectOption('selected');
    await expect(region.getByLabel('Status for Band – Hit')).toHaveValue('selected');
    await expect.poll(() => page.evaluate(() => window.__prep.get().knowledge.events.find(e => e.eventId === 'E1')?.shortlist[0]?.status)).toBe('selected');
    await region.getByRole('button', { name: 'Link a local file…' }).click();
    await region.getByLabel('Search your library to link a file').fill('Clean Edit');
    await region.getByRole('button', { name: /Hit \(Clean Edit\)/ }).click();
    await expect(region).toContainText('Linked file: Hit (Clean Edit).mp3');
    await region.getByLabel('Section to add shortlist songs to').selectOption('peak');
    await region.locator('li', { hasText: 'Band – Hit' }).getByRole('button', { name: 'Add to section' }).click();
    await expect(region.getByRole('status')).toContainText('already in this event'); // Band – Hit is in Warm Up
    await region.getByLabel('Copy group into shortlist').selectOption({ label: 'Wedding singalongs (2)' });
    await expect(region.getByRole('status')).toContainText('Copied 2 songs');
    await region.locator('li', { hasText: 'Queen – Song B' }).getByRole('button', { name: 'Add to section' }).click();
    await expect(page.getByTestId('event-row').filter({ hasText: 'Peak #1: Queen – Song B' })).toContainText('not approved');
    await prepTab(/Groups/).click();
    await expect(region).toContainText('Wedding singalongs (2)'); // group unchanged by copy
    await narrow('shortlist');
  });

  await check('backup round-trip through real browser + native validators restores preparation additively', async () => {
    await page.getByRole('button', { name: 'Go backup' }).click();
    await page.getByRole('button', { name: 'Back up preparation' }).click();
    await expect(page.getByLabel('Backup result')).toContainText('Backed up 1 groups, 1 track notes');
    await page.getByRole('button', { name: 'Wipe preparation (test only)' }).click();
    await expect(page.getByLabel('Backup result')).toHaveText('Wiped');
    await page.getByRole('button', { name: 'Restore preparation from device backup' }).click();
    await expect(page.getByLabel('Backup result')).toContainText(/Restored \d+ items/);
    await page.getByRole('button', { name: 'Restore preparation from device backup' }).click();
    await expect(page.getByLabel('Backup result')).toHaveText('Restored 0 items');
  });

  await close();
  await launch({ page: 'event' });
  await check('cold restart: notes, groups, shortlist and dismissals persist in the synthetic profile', async () => {
    await prepTab(/Shortlist/).click();
    const region = page.getByRole('region', { name: 'Event preparation' });
    await expect(region).toContainText('Band – Hit');
    await expect(region.getByLabel('Status for Band – Hit')).toHaveValue('selected');
    await prepTab(/Groups/).click();
    await expect(region).toContainText('Wedding singalongs (2)');
    await page.getByRole('button', { name: 'Go library' }).click();
    await page.locator('tbody tr', { hasText: 'b/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await expect(sheet().getByLabel('Personal note')).toHaveValue('Play right after speeches');
    await page.keyboard.press('Escape');
  });

  await check('sign-out revokes the open workspace; another account sees nothing', async () => {
    await page.evaluate(() => window.__switchAccount(null));
    await page.locator('tbody tr', { hasText: 'b/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
    await expect(sheet().getByLabel('Tags, comma separated')).toBeDisabled();
    await expect(sheet().getByLabel('Personal note')).toHaveValue('');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__switchAccount('synthetic-b'));
    await page.getByRole('button', { name: 'Go event' }).click();
    await prepTab(/Groups/).click();
    await expect(page.getByRole('region', { name: 'Event preparation' }).getByRole('tab', { name: /Groups/ })).toHaveText('Groups (0)');
  });

  const blocked = await page.evaluate(() => window.prepNative.blocked());
  if (blocked.length) throw Error(`Network requests left loopback: ${blocked.join(', ')}`);
  if (errors.length) throw Error(`Page errors: ${errors.join('; ')}`);
  console.log(`Preparation UI checks: ${count} passed. Isolated profile: ${temp}`);
} catch (e) {
  if (page) { await page.screenshot({ path: path.join(diagnostics, 'failure.png') }).catch(() => {}); console.error('TOASTS', JSON.stringify(await page.evaluate(() => window.__toasts).catch(() => null))); }
  console.error(e); process.exitCode = 1;
} finally { await close(); }
