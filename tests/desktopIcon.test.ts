import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import zlib from 'node:zlib';
const { inspectIcon } = createRequire(import.meta.url)('../desktop/verify-icon.cjs');
describe('exact transparent Mac icon', () => {
  it('retains transparent corners and opaque interior in the 1024 source', () => {
    const result = inspectIcon(fs.readFileSync('desktop/build/icon-source.png'), 1024);
    expect(result.corners).toEqual([0,0,0,0]);
    expect(result.opaqueInterior).toBeGreaterThan(10485);
  });
  it('rejects flattened artwork with a white rectangle', () => {
    const header=Buffer.alloc(13);header.writeUInt32BE(16,0);header.writeUInt32BE(16,4);header[8]=8;header[9]=6;
    const chunk=(name:string,data:Buffer)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);return b;};
    const rows=Buffer.alloc(16*65,255);for(let y=0;y<16;y++) rows[y*65]=0;
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
    expect(()=>inspectIcon(png,16)).toThrow('corners');
  });
});