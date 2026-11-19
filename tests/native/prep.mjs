// Real preparation-UI acceptance in a fenced synthetic Electron profile (network denied except loopback).
import { build } from 'esbuild'; import { _electron as electron, expect } from '@playwright/test';
import { compile } from '@tailwindcss/node'; import { Scanner } from '@tailwindcss/oxide';
import { malformedVdjFixture } from './fixtures/malformed-vdj.mjs';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'setarchitect-native-prep-')), bundle = path.join(temp, 'bundle');
fs.mkdirSync(bundle); fs.writeFileSync(path.join(temp, 'ISOLATED'), 'synthetic only');
const stub = path.join(root, 'tests/native/fixtures/prep-services.tsx');
const stubbed = ['@/lib/generationDiagnostics/relay.functions', '@/integrations/supabase/client', '@/lib/prep/lookup.functions', '@/lib/lastfm.functions', '@tanstack/react-router', '@tanstack/react-start', '@/lib/pageHead', 'sonner', '@/components/workspace/WaveformPlayer', '@/components/workspace/TrackTagEditor', '@/lib/audioMatch'];
await build({ entryPoints: [path.join(root, 'tests/native/fixtures/prep-entry.tsx')], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: path.join(bundle, 'app.js'), jsx: 'automatic', alias: { '@': path.join(root, 'src') }, logLevel: 'error',
  plugins: [{ name: 'isolated', setup(b) { b.onResolve({ filter: /.*/ }, a => { if (stubbed.includes(a.path) || /(^|\/)WorkspaceContext$/.test(a.path) || /(^|\/)WaveformPlayer$/.test(a.path)) return { path: stub }; }); } }] });
const css = await compile(fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8'), { base: path.join(root, 'src'), onDependency: () => {} });
fs.writeFileSync(path.join(bundle, 'app.css'), css.build(new Scanner({ sources: [{ base: root, pattern: 'src/**/*.{tsx,ts}', negated: false }] }).scan()));
fs.writeFileSync(path.join(bundle, 'index.html'), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module">window.__fixture=await window.prepNative.fixture();await import('/app.js');</script>`);
const T = p => `/synthetic/Music/${p}`;
const tracks = [
  { filePath: T('a/Song.mp3'), artist: 'Queen', title: 'Song A', genre: 'Rock', bpm: '120', songLength: '200', year: '1980', playCount: 3 },
  { filePath: T('b/Song.mp3'), artist: 'Queen', title: 'Song A', remix: 'Club Remix', genre: 'Dance', bpm: '128', songLength: '420', year: '1999', playCount: 0 },
  { filePath: T('Hit (Clean Edit).mp3'), artist: 'Band', title: 'Hit (Clean Edit)', genre: 'Pop', bpm: '100', playCount: 0, songLength: '200' },
  { filePath: T('Hit.mp3'), artist: 'Band', title: 'Hit', genre: 'Pop', bpm: '101', songLength: '180', playCount: 40 },
  { filePath: T('unknown.mp3'), artist: 'Other', title: 'Unknown' }, // no play history at all
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
  await check('persistent activity reload and sanitized copy never alter synthetic preparation', async () => {
    const before = await page.evaluate(() => JSON.stringify(window.__fixture.tracks));
    await page.evaluate(() => window.__addActivity());
    await page.reload(); await page.getByRole('button', {name:'Go library'}).waitFor();
    await page.getByRole('button', {name:'Recent generation activity'}).click();
    await page.getByText('Completed with warnings', {exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('Transition: 4 hr / 4 hr');
    await expect(page.getByRole('dialog')).toContainText('Warm Up: 1 hr 30 min / 1 hr 30 min');
    await expect(page.getByRole('dialog')).toContainText('Installed desktop version 1.2.99');
    await expect(page.getByRole('dialog')).toContainText('2 min 5 sec elapsed');
    await expect(page.getByRole('dialog')).toContainText('All selected section preparation targets were reached.');
    await expect(page.getByRole('dialog')).toContainText('ReccoBeats: rate limited; remaining checks were paced (5).');
    await expect(page.getByRole('dialog')).toContainText('MusicBrainz: temporary server failures; finished track details were kept (2).');
    await expect(page.getByRole('dialog')).not.toContainText('actual lookup timeouts');
    // Real clipboard under the production desktop permission policy; no mocked writes.
    const asyncDenied = await page.evaluate(() => navigator.clipboard.writeText('async-probe').then(() => false, () => true));
    expect(asyncDenied).toBe(true); // the installed shell denies the async Clipboard API, which caused the reported failure
    await app.evaluate(({ clipboard }) => clipboard.writeText('synthetic-sentinel'));
    await page.getByRole('button', {name:'Copy diagnostics'}).click();
    await expect(page.getByRole('dialog')).toContainText('Diagnostics copied');
    expect(await page.evaluate(() => document.querySelectorAll('[role="dialog"] textarea, body > textarea').length)).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Copy diagnostics');
    await expect(page.getByRole('dialog')).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).not.toBe('synthetic-sentinel');
    expect(JSON.parse(copied).requested).toBe(34);
    expect(JSON.parse(copied).coverage[1]).toEqual({ section: 'transition', targetSeconds: 14400, achievedSeconds: 14400 });
    expect(JSON.parse(copied).version).toBe('desktop:1.2.99');
    expect(JSON.parse(copied).elapsedMs).toBe(125000);
    expect(copied).not.toMatch(/filePath|\/synthetic\/|Queen|token|accountId|eventName/);
    expect(await page.evaluate(() => JSON.stringify(window.__fixture.tracks))).toBe(before);
    await page.getByRole('dialog').screenshot({ path: path.join(diagnostics, 'generation-activity-expanded.png') });
    // Honest failure: selection copy refused and async API denied -> visible sanitized text, clipboard untouched.
    await app.evaluate(({ clipboard }) => clipboard.writeText('synthetic-sentinel'));
    await page.evaluate(() => { window.__execCommand = document.execCommand; document.execCommand = () => false; });
    await page.getByRole('button', {name:'Copy diagnostics'}).click();
    await expect(page.getByRole('dialog')).toContainText('Copy unavailable. Select the text below and copy it.');
    expect(await page.getByLabel('Diagnostics text').inputValue()).toBe(copied);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('synthetic-sentinel');
    await page.evaluate(() => { document.execCommand = window.__execCommand; });
    // Account change while the dialog is open: the other account sees no rows, copy state or fallback text.
    await page.evaluate(() => window.__activity.activate('synthetic-other'));
    await expect(page.getByRole('dialog')).toContainText('No recent generation activity.');
    expect(await page.getByLabel('Diagnostics text').count()).toBe(0);
    await expect(page.getByRole('dialog')).not.toContainText('Copy unavailable');
    await page.evaluate(() => window.__activity.activate('synthetic-diagnostics'));
    // Switch BOTH the displayed account and the store while fallback text is visible, with an old copy still pending.
    await page.getByText('Completed with warnings', {exact:true}).click();
    await page.evaluate(() => { window.__execCommand = document.execCommand; document.execCommand = () => false; });
    await page.getByRole('button', {name:'Copy diagnostics'}).click();
    await expect(page.getByLabel('Diagnostics text')).toBeVisible();
    const switchBoth = account => page.evaluate(acct => {
      const { flushSync } = window.__reactDom;
      flushSync(() => { window.__setActivityAccount(acct); void window.__activity.activate(acct); });
      return { text: document.querySelector('[aria-label="Diagnostics text"]')?.value ?? null, status: document.querySelector('[role="dialog"]')?.textContent ?? '' };
    }, account);
    // (a) Fallback text visible for A, then prop and store move to B in one render.
    const sameRender = await switchBoth('synthetic-b');
    expect(await page.evaluate(() => window.__activityLeaks ?? [])).toEqual([]);
    expect(sameRender.text).toBeNull(); expect(sameRender.status).not.toContain('Copy unavailable');
    await switchBoth('synthetic-diagnostics');
    // (b) An old copy still pending when both identities move to B completes late and shows nothing.
    await page.getByText('Completed with warnings', {exact:true}).click();
    await page.evaluate(() => { window.__releaseCopy = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise((_, reject) => { window.__releaseCopy = () => reject(new DOMException('denied', 'NotAllowedError')); }) } }); });
    await page.getByRole('button', {name:'Copy diagnostics'}).click();
    await page.waitForFunction(() => typeof window.__releaseCopy === 'function');
    await switchBoth('synthetic-b');
    await page.evaluate(() => window.__releaseCopy());
    await page.waitForTimeout(300);
    expect(await page.getByLabel('Diagnostics text').count()).toBe(0);
    await expect(page.getByRole('dialog')).not.toContainText('Copy unavailable');
    await expect(page.getByRole('dialog')).not.toContainText('Diagnostics copied');
    expect(await page.evaluate(() => window.__activityLeaks ?? [])).toEqual([]);
    await page.evaluate(() => { document.execCommand = window.__execCommand; delete navigator.clipboard; window.__setActivityAccount('synthetic-diagnostics'); return window.__activity.activate('synthetic-diagnostics'); });
    await page.keyboard.press('Escape');
  });
  await check('activity distinguishes final short missing and real timeout reports', async () => {
    for (const mode of ['short', 'missing', 'deadline']) {
      await page.evaluate(mode => window.__addActivity(mode), mode); await page.reload();
      await page.getByRole('button', { name: 'Recent generation activity' }).click();
      const first = page.getByRole('dialog').locator('details').first(); await first.locator('summary').click();
      if (mode === 'short') await expect(first).toContainText('Not all selected section preparation targets were reached.');
      if (mode === 'missing') await expect(first).toContainText('Final preparation coverage was not recorded.');
      if (mode === 'deadline') await expect(first).toContainText('actual lookup timeouts');
      else await expect(first).not.toContainText('All selected section preparation targets were reached.');
      await first.screenshot({ path: path.join(diagnostics, `activity-${mode}.png`) });
      await page.keyboard.press('Escape');
    }
  });
  await check('VirtualDJ SongLength parsed by real DOMParser in Electron', async () => {
    const r = await page.evaluate(() => window.__parseVdj(`<VirtualDJ_Database><Song FilePath="/x/a.mp3"><Tags Author="A" Title="T"/><Infos SongLength="215.6"/></Song><Song FilePath="/x/b.mp3"><Tags Author="B" Title="U"/><Infos SongLength="nope"/></Song></VirtualDJ_Database>`));
    expect(r.map(t => t.songLength ?? null)).toEqual(['216', null]);
  });

  await check('malformed VirtualDJ XML recovered per entry by real DOMParser, identical to tolerant reader, no DTD expansion', async () => {
    const fx = malformedVdjFixture('/synthetic/Music');
    const { dom, tolerant, valid } = await page.evaluate(xml => ({
      dom: window.__parseVdjDetailed(xml), tolerant: window.__parseVdjDetailed(xml, { strictBlocks: false }),
      valid: window.__parseVdjDetailed('<VirtualDJ_Database><Song FilePath="/x/A &amp; B&apos;s.mp3"><Tags Author="A" Title="T"/><Infos SongLength="290.352086"/></Song></VirtualDJ_Database>'),
    }), fx.xml);
    expect(valid.mode).toBe('strict'); expect(valid.tracks[0]).toMatchObject({ filePath: "/x/A & B's.mp3", songLength: '290' });
    expect(dom.mode).toBe('recovered'); expect(dom.skippedCount).toBe(fx.skippedCount);
    expect(Object.fromEntries(dom.tracks.map(t => [t.filePath, t.songLength ?? null]))).toEqual({ ...fx.expectedLength, [fx.files.zero]: null, [fx.files.bad]: null });
    expect(dom.tracks).toEqual(tolerant.tracks); expect(dom.skipped).toEqual(tolerant.skipped);
    expect(dom.tolerantCount).toBe(3); // broken, bare "&", undeclared entity; the rest parsed strictly
    expect(JSON.stringify(dom)).not.toMatch(/EXPANDED|passwd/);
    const nul = await page.evaluate(() => { const s = (n, l) => ` <Song FilePath="/x/${n}"><Tags Title="${n}"/><Infos SongLength="${l}"/></Song>`; return ['<VirtualDJ_Database>', s('Ain&apos;t.mp3', '290.352086'), '\u0000' + s('B &amp; C.mp3', '200'), s('D.mp3', '100'), '</VirtualDJ_Database>', '\u0000'].join('\n'); }).then(xml => page.evaluate(x => window.__parseVdjDetailed(x), xml));
    expect(nul.mode).toBe('recovered'); expect(nul.skippedCount).toBe(0);
    expect(nul.tracks.map(t => [t.filePath, t.songLength])).toEqual([["/x/Ain't.mp3", '290'], ['/x/B & C.mp3', '200'], ['/x/D.mp3', '100']]);
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
    const plays = () => sheet().locator('dt', { hasText: /^Plays$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(plays()).toHaveText(/^0\b/); // known zero is shown as 0, not Unknown
    await sheet().getByRole('button', { name: 'Preview waveform' }).click();
    expect((await page.evaluate(() => window.__previews)).at(-1).filePath).toBe(T('b/Song.mp3'));
    await narrow('detail-sheet');
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: 'unknown.mp3' }).getByRole('button', { name: /Details for Unknown/ }).click();
    await expect(plays()).toHaveText('Unknown'); // missing history stays unknown
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: 'b/Song.mp3' }).getByRole('button', { name: /Details for Song A/ }).click();
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

  await check('track information survives reload and repeat details avoid provider calls', async () => {
    await page.reload(); await page.getByRole('button', { name: 'Go library' }).click();
    const before = await page.evaluate(() => JSON.stringify(window.__fixture.tracks));
    await page.locator('tbody tr', { hasText: 'Song B.mp3' }).getByRole('button', { name: /Details for Song B/ }).click();
    await sheet().getByRole('button', { name: 'MusicBrainz', exact: true }).click();
    await sheet().getByRole('button', { name: 'Last.fm tags & similar' }).click();
    await expect(sheet().getByLabel('MusicBrainz results')).toBeVisible();
    await expect(sheet().getByLabel('Last.fm results')).toBeVisible();
    expect(await page.evaluate(() => window.__lookup.mbCalls)).toBe(0);
    expect(await page.evaluate(() => window.__lookup.lfCalls)).toBe(0);
    await expect(sheet()).toContainText('reused on this device');
    await expect(sheet()).toContainText('Updated');
    await narrow('reused-track-details');
    expect(await page.evaluate(() => JSON.stringify(window.__fixture.tracks))).toBe(before);
    await page.keyboard.press('Escape');
  });

  await check('local track information merges per field across connections, reversed completion, account fences and reload', async () => {
    const setup = await page.evaluate(async () => {
      const { indexedInformationStorage, createLocalInformation, informationKey } = window.__trackInformation;
      const artist = 'TEST Native Merge', song = 'Exact (Live)', key = informationKey('metadata', artist, song), now = Date.now(), DAY = 86400000;
      const strong = { key, kind: 'metadata', at: now - 1000, value: { artist, song, source: 'ReccoBeats+MusicBrainz', energy: 8, danceability: 7, year: 2004, prov: { energy: 'provider', danceability: 'provider', year: 'provider' }, checked: { energy: now - 1000, danceability: now - 1000, year: now - 1000 }, updated: { energy: now - DAY, danceability: now - DAY, year: now - DAY } } };
      // Newer, weaker partial reply from another caller/window: estimate energy, absent year.
      const weak = { key, kind: 'metadata', at: now, value: { artist, song, source: 'AI', energy: 3, danceability: 7, prov: { energy: 'estimate', danceability: 'provider' }, checked: { energy: now, danceability: now }, updated: { energy: now, danceability: now - DAY } } };
      const a = indexedInformationStorage(), b = indexedInformationStorage();
      await a.write('native-owner-A', strong); await b.write('native-owner-A', weak);
      await b.write('native-owner-B', weak); await a.write('native-owner-B', strong);
      const local = createLocalInformation(a), fence = local.session('native-owner-C'); local.activate('native-owner-D');
      const fenced = await local.write('native-owner-C', strong, fence, Date.now() + 1000);
      return { key, now, DAY, fenced };
    });
    expect(setup.fenced).toBe(false);
    await page.reload(); await page.getByRole('button', { name: 'Go library' }).waitFor({ timeout: 20000 });
    const got = await page.evaluate(async key => { const s = window.__trackInformation.indexedInformationStorage();
      return { A: await s.read('native-owner-A', key), B: await s.read('native-owner-B', key), C: await s.read('native-owner-C', key), X: await s.read('native-owner-X', key) }; }, setup.key);
    for (const owner of ['A', 'B']) {
      expect(got[owner].value).toMatchObject({ energy: 8, danceability: 7, year: 2004, prov: { energy: 'provider', year: 'provider' } });
      expect(got[owner].value.updated).toMatchObject({ energy: setup.now - setup.DAY, year: setup.now - setup.DAY, danceability: setup.now - setup.DAY });
      expect(got[owner].value.checked.danceability).toBe(setup.now);
    }
    expect(got.C).toBeUndefined(); expect(got.X).toBeUndefined();
    expect(errors).toEqual([]);
  });

  await check('local capacity prune observes the refreshed entry in the same transaction; other accounts untouched', async () => {
    const r = await page.evaluate(async () => {
      const { indexedInformationStorage, informationKey, MAX_LOCAL_ENTRIES } = window.__trackInformation;
      const now = Date.now(), DAY = 86400000, owner = 'native-cap-A', other = 'native-cap-B';
      const entry = (i, at, energy, prov) => { const artist = 'TEST Cap ' + i, song = 'Exact'; return { key: informationKey('metadata', artist, song), kind: 'metadata', at, value: { artist, song, source: 'ReccoBeats', energy, danceability: 5, prov: { energy: prov, danceability: 'provider' }, checked: { energy: at, danceability: at }, updated: { energy: at, danceability: at } } }; };
      const db = await new Promise((res, rej) => { const o = indexedDB.open('setarchitect-track-information-v1', 1); o.onupgradeneeded = () => o.result.createObjectStore('evidence'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
      const seeded = Array.from({ length: MAX_LOCAL_ENTRIES + 1 }, (_, i) => entry(i, now - 10 * DAY + i * 1000, 4, 'ai'));
      await new Promise((res, rej) => { const tx = db.transaction('evidence', 'readwrite'), s = tx.objectStore('evidence');
        for (const e of seeded) s.put(e, [owner, e.key]); for (const e of seeded.slice(0, 2)) s.put(e, [other, e.key]);
        tx.oncomplete = res; tx.onerror = rej; });
      db.close();
      const refreshed = entry(0, now, 9, 'measured');
      const storage = indexedInformationStorage(); await storage.write(owner, refreshed);
      const count = acct => new Promise(res => { const o = indexedDB.open('setarchitect-track-information-v1', 1); o.onsuccess = () => { const q = o.result.transaction('evidence').objectStore('evidence').count(IDBKeyRange.bound([acct, ''], [acct, '\uffff'])); q.onsuccess = () => { o.result.close(); res(q.result); }; }; });
      return { max: MAX_LOCAL_ENTRIES, count: await count(owner), otherCount: await count(other), kept: await storage.read(owner, refreshed.key), evicted: await storage.read(owner, seeded[1].key), third: await storage.read(owner, seeded[2].key), other0: await storage.read(other, seeded[0].key), other1: await storage.read(other, seeded[1].key) };
    });
    expect(r.count).toBeLessThanOrEqual(r.max); expect(r.count).toBe(r.max);
    expect(r.kept?.value).toMatchObject({ energy: 9, prov: { energy: 'measured' } });
    expect(r.evicted).toBeUndefined(); expect(r.third).toBeDefined();
    expect(r.otherCount).toBe(2); expect(r.other0.value.energy).toBe(4); expect(r.other1.value.energy).toBe(4);
    expect(errors).toEqual([]);
  });

  await page.getByRole('button', { name: 'Go event' }).click();
  await check('dashboard categories and drilldown follow export semantics', async () => {
    const region = page.getByRole('region', { name: 'Event preparation' });
    await expect(region).toContainText('1 unique eligible tracks');
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
    // Track-level Last.fm evidence: rate limit is reported truthfully, then real multi-seed track evidence appears.
    await page.evaluate(() => { window.__lookup.trackSimFail = true; });
    await region.getByRole('button', { name: 'Add Last.fm similar tracks' }).click();
    await expect(region.getByTestId('lastfm-track-note')).toContainText('rate limited');
    await page.evaluate(() => { window.__lookup.trackSimFail = false; });
    await region.getByRole('button', { name: 'Add Last.fm similar tracks' }).click();
    await expect(region.getByTestId('lastfm-track-note')).toContainText('Using Last.fm similar tracks');
    await expect(region.locator('ul > li', { hasText: 'Familiar Act – Classic' })).toContainText('Last.fm lists this exact track as similar to');
    const sentSeeds = await page.evaluate(() => window.__lookup.trackSeeds);
    if (!sentSeeds.length || sentSeeds.some(s => Object.keys(s).sort().join() !== 'artist,title')) throw Error('Last.fm seeds must be artist/title only');
    // A failed refresh clears earlier track evidence instead of leaving it looking current; a good refresh restores it.
    await page.evaluate(() => { window.__lookup.trackSimThrow = true; });
    await region.getByRole('button', { name: 'Add Last.fm similar tracks' }).click();
    await expect(region.getByTestId('lastfm-track-note')).toContainText("Couldn't reach Last.fm");
    await expect(region).not.toContainText('Last.fm lists this exact track as similar to');
    await page.evaluate(() => { window.__lookup.trackSimThrow = false; });
    await region.getByRole('button', { name: 'Add Last.fm similar tracks' }).click();
    await expect(region.locator('ul > li', { hasText: 'Familiar Act – Classic' })).toContainText('Last.fm lists this exact track as similar to');
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
    // Optional event-scoped rejection reason, shown in the hidden list and undoable.
    await r2.locator('ul > li', { hasText: 'Queen – Song B' }).getByRole('button', { name: /here: Too slow$/ }).click();
    await expect(r2.locator('ul > li', { hasText: 'Queen – Song B' })).toHaveCount(0);
    if (!(await r2.getByRole('button', { name: 'Undo' }).first().isVisible())) await r2.getByText('Manage hidden songs').click();
    await expect(r2.getByText('Queen – Song B · Too slow')).toBeVisible();
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
    // Keep the first save pending while the next entry is typed: the typing must survive and Add is locked.
    await page.evaluate(() => { window.__idbCompleteDelay = 800; });
    await region.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(region.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    await region.getByLabel('Shortlist artist').fill('band'); await region.getByLabel('Shortlist title').fill('hit'); await region.getByLabel('Desired version', { exact: true }).fill('clean edit');
    await expect.poll(() => page.evaluate(() => window.__prep.get().knowledge.events.find(e => e.eventId === 'E1')?.shortlist.length ?? 0)).toBe(1);
    await page.evaluate(() => { window.__idbCompleteDelay = 0; });
    await expect(region.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
    await expect(region.getByLabel('Shortlist artist')).toHaveValue('band');
    await expect(region.getByLabel('Shortlist title')).toHaveValue('hit');
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
    await region.getByLabel('New group name').fill('Temp group'); await region.getByRole('button', { name: 'Create', exact: true }).click();
    const temp = region.locator('details', { hasText: 'Temp group' });
    await temp.getByRole('button', { name: 'Rename' }).click();
    await temp.getByLabel('New name for Temp group').fill('Temp renamed'); await temp.getByRole('button', { name: 'Save name' }).click();
    await expect(region).toContainText('Temp renamed (0)');
    page.once('dialog', d => d.accept());
    await region.locator('details', { hasText: 'Temp renamed' }).getByRole('button', { name: 'Delete' }).click();
    await expect(region).not.toContainText('Temp renamed');
    await prepTab(/Shortlist/).click();
    const note = region.getByLabel('Desired version note for Band – Hit');
    await note.fill('clean radio edit'); await note.blur();
    await expect.poll(() => page.evaluate(() => window.__prep.get().knowledge.events.find(e => e.eventId === 'E1').shortlist[0].versionNote)).toBe('clean radio edit');
    await prepTab(/Groups/).click();
    await narrow('shortlist');
  });

  await check('review recommendation quality: capture unrated sample, rate/change/clear, reload and account isolation, no feedback change', async () => {
    await page.getByRole('button', { name: 'Go event' }).click();
    const region = page.getByRole('region', { name: 'Event preparation' });
    await prepTab('Recommendations').click();
    const hiddenLine = () => region.getByText(/^Client requests always stay in the event\. Hidden:/).textContent();
    const hiddenBefore = await hiddenLine();
    // Non-default controls must be frozen with the sample so the replay matches exactly.
    const fam = region.getByRole('slider', { name: 'Discovery to familiar' }); await fam.focus(); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    const vari = region.getByRole('slider', { name: 'Artist variety' }); await vari.focus(); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await prepTab(/Review quality/).click();
    await expect(region.getByRole('heading', { name: 'Review recommendation quality' })).toBeVisible();
    await region.getByLabel('Review sample name').fill('Synthetic review');
    await region.getByRole('button', { name: /Save current top \d+ for review/ }).click();
    await expect(region.getByTestId('quality-note')).toContainText('All start unrated');
    const sample = region.getByTestId('quality-sample').first();
    await expect(sample).toContainText('0 reviewed');
    await sample.locator('summary').click();
    await expect(sample.getByTestId('quality-compare')).toContainText('same order and reasons');
    await expect(sample).toContainText('Rate at least 3 tracks');
    const rate = (label, n) => sample.getByRole('button', { name: new RegExp(`^${label}: `) }).nth(n);
    await rate('Poor fit', 0).click(); await expect(rate('Poor fit', 0)).toHaveAttribute('aria-pressed', 'true');
    await rate('Good fit', 0).click(); await expect(rate('Good fit', 0)).toHaveAttribute('aria-pressed', 'true');
    await expect(rate('Poor fit', 0)).toHaveAttribute('aria-pressed', 'false');
    await rate('Maybe', 1).click(); await rate('Poor fit', 2).click();
    await expect(sample).toContainText('3 reviewed');
    await expect(sample.getByTestId('quality-compare')).toContainText(/Good fits in the top 5: \d+ as saved, \d+ now \(counting only rated tracks\)/);
    await expect(sample.getByTestId('quality-compare')).not.toContainText(/gain|%/);
    await sample.getByRole('button', { name: /^Clear rating: / }).nth(2).click();
    await expect(sample).toContainText('2 reviewed');
    await expect(sample).toContainText('Rate at least 3 tracks');
    // Ratings never become Never/favourite feedback or event dismissals.
    await prepTab('Recommendations').click();
    if (await hiddenLine() !== hiddenBefore) throw Error('Rating changed Never/dismissal counts');
    // Reload keeps the sample for this account; another account sees none.
    await page.reload(); await page.getByRole('button', { name: 'Go library' }).waitFor();
    await page.getByRole('button', { name: 'Go event' }).click();
    await prepTab(/Review quality \(1\)/).click();
    await expect(region.getByTestId('quality-sample').first()).toContainText('2 reviewed');
    await region.getByTestId('quality-sample').first().locator('summary').click();
    await expect(region.getByTestId('quality-compare').first()).toContainText('same order and reasons'); // after reload, default controls on screen
    await page.evaluate(() => window.__switchAccount('synthetic-b'));
    await expect(prepTab(/Review quality \(0\)/)).toBeVisible();
    await page.evaluate(() => window.__switchAccount('synthetic-a'));
    await expect(prepTab(/Review quality \(1\)/)).toBeVisible();
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


  await check('event policies constrain real recommendations and shortlist addition, toggle does not alter knowledge', async()=>{
    // Remount event fixtures too: changing account fences knowledge, not test-only event rows.
    await close();await launch();await page.evaluate(async()=>{await window.__switchAccount('synthetic-policy');});
    await page.getByRole('button',{name:'Go event'}).click();
    await page.evaluate(()=>window.__setPolicy({ownedOnlyExpansion:true,includeSeasonalTracks:false,requireCleanVersions:true}));
    await prepTab('Recommendations').click();const region=page.getByRole('region',{name:'Event preparation'});
    await expect(region.getByRole('button',{name:'Details for Band – Hit (Clean Edit)',exact:true})).toBeVisible();
    await expect(region.getByRole('button',{name:'Details for Queen – Song B',exact:true})).toHaveCount(0);
    await prepTab(/Shortlist/).click();await region.getByLabel('Shortlist artist').fill('Discovery Artist');await region.getByLabel('Shortlist title').fill('Deep Cut');
    await region.getByRole('button',{name:'Add',exact:true}).click();await expect(region.locator('li',{hasText:'Discovery Artist – Deep Cut'})).toBeVisible();
    await region.locator('li',{hasText:'Discovery Artist – Deep Cut'}).getByRole('button',{name:'Add to section',exact:true}).click();
    await expect(region.getByRole('status')).toHaveText('Clean version needed — choose a labelled clean file or explicitly change this event’s policy.');
    await page.evaluate(()=>window.__setPolicy({requireCleanVersions:false}));await prepTab('Recommendations').click();
    await expect(region.getByRole('button',{name:'Details for Queen – Song B',exact:true})).toBeVisible();
  });
  await check('dashboard keeps clean extras count and duration alongside blocked primary review', async()=>{
    await page.evaluate(()=>{
      window.__setPolicy({requireCleanVersions:true});
      window.__setEventMatches({'warmUp:1:band|hit':{status:'Manually Matched',confidence:1,trackIndex:3,extraTrackIndices:[2],confirmed:true,alternatives:[]}});
    });
    await prepTab('Overview').click();const region=page.getByRole('region',{name:'Event preparation'});
    await expect(region).toContainText('1 unique eligible tracks · approved length 3:20');
    await region.getByRole('button',{name:/Waiting for your approval/}).click();
    await expect(region.getByRole('button',{name:/Band – Hit.*Clean version needed/})).toBeVisible();
  });
  await check('duplicate selected primary/extras show unique duration and review without modifying selections',async()=>{
    await page.evaluate(()=>{window.__setPolicy({requireCleanVersions:false});window.__setEventMatches({
      'warmUp:0:queen|song a':{status:'Manually Matched',confidence:1,trackIndex:0,extraTrackIndices:[1],confirmed:true,alternatives:[]},
      'warmUp:1:band|hit':{status:'Manually Matched',confidence:1,trackIndex:0,confirmed:true,alternatives:[]},
    });});
    await prepTab('Overview').click();const region=page.getByRole('region',{name:'Event preparation'});
    await expect(region).toContainText('2 unique eligible tracks · approved length 10:20');
    const drill=region.getByRole('button',{name:/Waiting for your approval/});
    if(await drill.getAttribute('aria-expanded')!=='true')await drill.click();
    await expect(region.getByRole('button',{name:/Band – Hit.*Repeated selected file/})).toBeVisible();
    await region.getByRole('button',{name:/Band – Hit.*Repeated selected file/}).click();
    expect(await page.evaluate(()=>window.__jumps.at(-1))).toBe('warmUp:1');
    await narrow('duplicate-coverage');
  });
  const blocked = await page.evaluate(() => window.prepNative.blocked());
  if (blocked.length) throw Error(`Network requests left loopback: ${blocked.join(', ')}`);
  if (errors.length) throw Error(`Page errors: ${errors.join('; ')}`);
  console.log(`Preparation UI checks: ${count} passed. Isolated profile: ${temp}`);
} catch (e) {
  if (page) { await page.screenshot({ path: path.join(diagnostics, 'failure.png') }).catch(() => {}); console.error('TOASTS', JSON.stringify(await page.evaluate(() => window.__toasts).catch(() => null))); }
  console.error(e); process.exitCode = 1;
} finally { await close(); }
