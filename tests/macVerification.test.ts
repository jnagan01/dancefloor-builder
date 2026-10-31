import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function run(fault = '') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-mac-verification-'));
  const app=path.join(root,'App with spaces.app'), log=path.join(root,'signature.log'), calls=path.join(root,'calls');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(root,'codesign'),`#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = '--verify' ]; then [ "$FAULT" != verify ]; exit $?; fi
[ "$1" = '-d' ] && [ "$2" = '--verbose=4' ] || exit 9
[ "$FAULT" != display ] || exit 3
if [ "$FAULT" = authority ]; then echo 'Authority=Apple Development: Fixture' >&2; else echo 'Authority=Developer ID Application: Fixture' >&2; fi
`,{mode:0o755});
  fs.writeFileSync(path.join(root,'xcrun'),`#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
[ "$1" = stapler ] && [ "$2" = validate ] && [ "$FAULT" != staple ]
`,{mode:0o755});
  try {
    const result=spawnSync('bash',['desktop/verify-mac-app.sh',app,log],{env:{...process.env,PATH:`${root}:${process.env.PATH}`,FAULT:fault,CALLS:calls},encoding:'utf8'});
    return {status:result.status, calls:fs.readFileSync(calls,'utf8'),log:fs.existsSync(log)?fs.readFileSync(log,'utf8'):''};
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
describe('read-only Mac inner-app verification command gate',()=>{
  it('captures verbose Authority chain then validates the inner-app ticket',()=>{const r=run();expect(r.status).toBe(0);expect(r.calls).toContain('--verify --deep --strict --verbose=2');expect(r.calls).toContain('-d --verbose=4');expect(r.log).toContain('Authority=Developer ID Application:');expect(r.calls).toContain('stapler validate');expect(r.calls).not.toContain('.dmg');});
  it.each(['verify','display','authority','staple'])('fails closed on %s failure',fault=>{const r=run(fault);expect(r.status).not.toBe(0);if(fault!=='staple')expect(r.calls).not.toContain('stapler validate');});
});