import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';
import * as bridge from '@/lib/desktopBridge';
import * as audio from '@/lib/audioMatch';
import * as identity from '@/lib/fileIdentity';
import * as metadata from '@/lib/trackMetadataIdentity';
import * as cache from '@/lib/workspaceFileCache';
import * as safety from '@/lib/nativeScanSafety';
import * as workspaceIndexes from '@/lib/workspaceIndexes';
import * as trackRevisions from '@/lib/trackRevisions';
// @ts-expect-error plain JS fixture shared with the Electron suites
import { malformedVdjFixture } from './native/fixtures/malformed-vdj.mjs';
const require = createRequire(import.meta.url);
const { createHarnessModules } = require('./helpers/workspaceHarness.cjs');

describe('actual workspace VirtualDJ refresh summary', () => {
  it('reports real matches and lengths even when React defers the library update (was "0 matched")', async () => {
    const fx = malformedVdjFixture('/mock/Music');
    const F = fx.files;
    const reads: string[] = [];
    const { harness } = createHarnessModules({
      vdj, audio, identity, metadata, cache, safety, workspaceIndexes, trackRevisions,
      bridge: { ...bridge, isDesktopApp: () => true, readVdjDatabase: async (p: string) => { reads.push(p); return { ok: true, path: '/mock/database.xml', xml: fx.xml }; } },
    });
    const toasts: Array<[string, string]> = [];
    const tracks = [
      { filePath: F.bill, artist: 'Bill Withers', title: "Ain't No Sunshine" },
      { filePath: F.billOther, artist: 'Bill Withers', title: "Ain't No Sunshine" },
      { filePath: F.zero, artist: 'Zed', title: 'Zero', songLength: '111' },
      { filePath: F.unclosed, artist: 'Unclosed', title: 'Quote', songLength: '333' },
    ];
    const h = harness([{ label: 'Music', tracks }], true, { deferUpdates: true, toasts });
    await h.render().refreshVdj();
    expect(toasts).toEqual([
      ['success', 'Synced 11 VirtualDJ tracks · 3 matched in your folders · 4 with length'],
      ['warning', '2 damaged VirtualDJ entries were skipped; those tracks keep their saved details.'],
    ]);
    const after = h.render().sources[0].tracks;
    expect(after.map((t: { filePath: string; songLength?: string }) => [t.filePath, t.songLength])).toEqual([[F.bill, '290'], [F.billOther, '120'], [F.zero, '111'], [F.unclosed, '333']]);
  });
});
