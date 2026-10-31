import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { createUpdateController } = require('../desktop/update-controller.cjs');
async function startup(options: { discovery?: boolean; rejection?: boolean; failure?: string; later?: boolean } = {}) {
  const calls: any[] = [], stages: string[] = [];
  const updater: any = new EventEmitter();
  updater.checkForUpdates = async () => { if(options.discovery) throw Error('offline discovery'); return {updateInfo:{version:'2.0.0'}}; };
  updater.downloadUpdate = async () => { if(options.failure === 'download') throw Error('download rejected'); };
  updater.quitAndInstall = () => { stages.push('squirrel'); if(options.failure === 'staging') throw Error('staging rejected'); };
  const controller = createUpdateController({updater,currentVersion:'1.0.0',newer:()=>true,cancellation:()=>({cancelled:false}),preserve:async()=>{if(options.failure==='backup')throw Error('backup rejected');},release:async()=>{}});
  if(options.rejection) controller.install=async()=>{throw Error('install rejected');};
  const module: any = { exports: {} };
  const source=fs.readFileSync('desktop/updater.cjs','utf8').replace('let controller, checkingDialog = false;', 'let controller = injectedController, checkingDialog = false;');
  vm.runInNewContext(source,{module,exports:module.exports,injectedController:controller,process, __dirname:'/synthetic',require:(name:string)=>name==='electron'?{app:{getVersion:()=> '1.0.0'},BrowserWindow:{getAllWindows:()=>[]},dialog:{showMessageBox:async(_parent:any,box:any)=>{calls.push(box);return {response:options.later?1:0};}}}:name==='./update-controller.cjs'?{createUpdateController}:require(name)});
  await module.exports.checkForUpdates({silent:true});
  return {calls,stages,controller};
}
describe('silent startup discovery with explicit update consent',()=>{
  it('shows a rejected install after startup Update now',async()=>{const {calls}=await startup({rejection:true});expect(calls.map(x=>x.type)).toEqual(['info','error']);expect(calls[1].detail).toBe('install rejected');});
  it.each(['download','backup','staging'])('shows %s failure after startup consent',async(failure)=>{const {calls,stages,controller}=await startup({failure});expect(calls.map(x=>x.type)).toEqual(['info','error']);expect(calls[1].detail).toBe(`${failure} rejected`);if(failure!=='staging')expect(stages).toEqual([]);else {expect(controller.blocksQuit()).toBe(true);expect(controller.blocksNavigation()).toBe(true);expect(controller.installAuthorized()).toBe(false);}});
  it('keeps only discovery errors silent',async()=>{expect((await startup({discovery:true})).calls).toEqual([]);});
  it('Later never starts installation',async()=>{const {calls,stages}=await startup({later:true,failure:'backup'});expect(calls).toHaveLength(1);expect(stages).toEqual([]);});
});