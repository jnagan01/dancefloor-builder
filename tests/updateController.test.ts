import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { createUpdateController } = require('../desktop/update-controller.cjs');
const { releaseVersion } = require('../desktop/release-version.cjs');
const { verifyRelease } = require('../desktop/verify-release.cjs');
const deferred = () => { let resolve: (value?: unknown) => void = () => {}; let reject: (error: Error) => void = () => {}; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture(options: any = {}) {
  const calls: string[] = [];
  const updater: any = new EventEmitter();
  updater.checkForUpdates = async () => { calls.push('check'); if(options.offline) throw Error('offline'); return { updateInfo: { version: options.version ?? '1.2.29' } }; };
  updater.downloadUpdate = async (token: any) => { calls.push('download'); updater.emit('download-progress',{percent:42}); if(options.download) await options.download(token); calls.push('downloaded'); };
  updater.quitAndInstall = () => { calls.push('squirrel'); if(options.stageError) throw Error('staging'); };
  const token = { cancelled: false, cancel() { this.cancelled = true; } };
  const c = createUpdateController({updater,currentVersion:'1.2.28',newer:(a:string,b:string)=>require('semver').valid(a)&&require('semver').gt(a,b),cancellation:()=>token,preserve:async()=>{calls.push('preserve');await options.preserve?.();calls.push('fsynced');},release:async()=>calls.push('release')});
  return { c, updater, calls, token };
}
describe('guarded signed Mac update controller',()=>{
  it('disables auto download, downgrade, prerelease and Squirrel staging on quit',()=>{const {updater}=fixture();expect(updater.autoDownload).toBe(false);expect(updater.autoInstallOnAppQuit).toBe(false);expect(updater.allowDowngrade).toBe(false);expect(updater.allowPrerelease).toBe(false);expect(updater.autoRunAppAfterInstall).toBe(true);});
  it('one explicit install waits for download then fresh preservation BEFORE Squirrel',async()=>{const download=deferred(),backup=deferred();const {c,calls}=fixture({download:()=>download.promise,preserve:()=>backup.promise});await c.check();const p=c.install();expect(c.status()).toMatchObject({phase:'downloading',percent:42});expect(c.blocksQuit()).toBe(true);expect(calls).toEqual(['check','download']);download.resolve();await new Promise(r=>setTimeout(r,0));expect(c.blocksNavigation()).toBe(true);expect(calls).toEqual(['check','download','downloaded','preserve']);backup.resolve();await p;expect(calls).toEqual(['check','download','downloaded','preserve','fsynced','squirrel']);expect(c.installAuthorized()).toBe(true);});
  it.each(['backup','journal','account changed','library changed'])('fails closed on %s preservation error',async(error)=>{const {c,calls}=fixture({preserve:()=>{throw Error(error);}});await c.check();await c.install();expect(calls).not.toContain('squirrel');expect(calls).toContain('release');expect(c.status()).toMatchObject({phase:'failed',error});expect(c.installAuthorized()).toBe(false);});
  it('offline check reports failure without download or install',async()=>{const {c,calls}=fixture({offline:true});await c.check();expect(c.status().phase).toBe('failed');await c.install();expect(calls).toEqual(['check']);});
  it.each(['1.2.27','1.2.28','invalid'])('never installs non-newer %s',async(version)=>{const {c,calls}=fixture({version});await c.check();await c.install();expect(c.status().phase).toBe('current');expect(calls).toEqual(['check']);});
  it('cancellation cannot preserve or stage and retry stays explicit',async()=>{const download=deferred();const {c,calls}=fixture({download:()=>download.promise});await c.check();const p=c.install();c.cancel();download.resolve();await p;expect(c.status().phase).toBe('cancelled');expect(calls).not.toContain('squirrel');expect(calls).not.toContain('preserve');expect(c.blocksQuit()).toBe(false);});
  it('failed download releases safely and never invokes Squirrel',async()=>{const {c,calls}=fixture({download:()=>{throw Error('network');}});await c.check();await c.install();expect(c.status().phase).toBe('failed');expect(calls).not.toContain('preserve');expect(calls).not.toContain('squirrel');});
  it('concurrent check/install shares work, cannot start another download',async()=>{const d=deferred();const {c,calls}=fixture({download:()=>d.promise});await c.check();const a=c.install(),b=c.install(),e=c.check();expect(a).toBe(b);expect(a).toBe(e);expect(calls.filter(x=>x==='download')).toHaveLength(1);d.resolve();await a;});
  it('staging error retains freeze and blocks quit: staged updates may install on ordinary quit',async()=>{const {c,calls}=fixture({stageError:true});await c.check();await c.install();expect(c.status().phase).toBe('staging-failed');expect(c.blocksQuit()).toBe(true);expect(c.blocksNavigation()).toBe(true);expect(c.installAuthorized()).toBe(false);expect(calls).not.toContain('release');});
  it('asynchronous native staging error also blocks quit',async()=>{const {c,updater}=fixture();await c.check();await c.install();updater.emit('error',Error('signature rejected'));expect(c.blocksQuit()).toBe(true);expect(c.installAuthorized()).toBe(false);});
});
describe('coherent release versions and actual artifact hashes',()=>{
  it('increments real patch versions on each workflow run including legacy bootstrap',()=>{expect(releaseVersion('1.2.0',28)).toEqual({version:'1.2.28',tag:'v1.2.28'});expect(releaseVersion('1.2.0',29).version).toBe('1.2.29');expect(require('semver').gt('1.2.28','1.1.0')).toBe(true);expect(()=>releaseVersion('1.2.0',28,'v1.1.0-build.28')).toThrow();expect(releaseVersion('1.2.0',28,'v1.2.28').tag).toBe('v1.2.28');});
  it('reads ZIP/DMG bytes and refuses corrupted or mismatched feed',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-update-artifacts-'));const files=['zip','dmg'].map(ext=>{const url=`SetArchitect-1.2.28-arm64.${ext}`,bytes=Buffer.from(`synthetic ${ext}`);fs.writeFileSync(path.join(dir,url),bytes);return {url,size:bytes.length,sha512:crypto.createHash('sha512').update(bytes).digest('base64')};});fs.writeFileSync(path.join(dir,'latest-mac.yml'),JSON.stringify({version:'1.2.28',files}));expect(verifyRelease(dir,'1.2.28',JSON.parse).files).toHaveLength(2);expect(()=>verifyRelease(dir,'1.2.29',JSON.parse)).toThrow();fs.appendFileSync(path.join(dir,files[0].url),'corrupt');expect(()=>verifyRelease(dir,'1.2.28',JSON.parse)).toThrow();fs.rmSync(dir,{recursive:true});});
});