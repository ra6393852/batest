// A real server and a freshly pinned CUSTOMER build; no runtime license bypass.
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
const run=(args,env=process.env)=>new Promise((ok,fail)=>{const child=spawn(process.execPath,args,{env,stdio:'inherit'});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(Error('검사 프로세스 실패: '+code)));});
if(process.platform!=='win32')throw Error('Windows DPAPI/판매용 EXE 검사는 Windows에서 실행하세요. Linux에서는 단위/HTTP 검사를 사용합니다.');
await run(['scripts/build-license-server.mjs']);
const {LicenseStore,createLicenseServer,initialize,readSettings}=createRequire(import.meta.url)('../dist/license-server/library.cjs');
const directory=mkdtempSync(join(tmpdir(),'baccarat-sales-')),password=randomBytes(24).toString('hex');
initialize(directory,'http://127.0.0.1',password);const settings=readSettings(directory),clockFile=join(directory,'clock.json');writeFileSync(clockFile,'0');
const clock=()=>Date.now()+Number(readFileSync(clockFile,'utf8'));
const store=new LicenseStore(join(directory,'licenses.sqlite'),settings.privateKey,clock),server=createLicenseServer(store,settings,directory,clock);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));settings.url='http://127.0.0.1:'+server.address().port;
const configPath=join(directory,'license-public.json');writeFileSync(configPath,JSON.stringify({url:settings.url,publicKey:settings.publicKey}));
const item=store.issue(3,1,'desktop fixture').rows[0],info=join(directory,'test-info.json');writeFileSync(info,JSON.stringify({url:settings.url,password,item,clockFile}));
const env={...process.env,LICENSE_CONFIG_FILE:configPath,REQUIRE_LICENSE_BUILD:'1',LICENSE_E2E_INFO:info};
try{
  await run(['scripts/build.mjs'],env);
  if(process.argv.includes('--package')){
    await run(['node_modules/electron-builder/cli.js','--win','dir','--x64','--config.directories.output='+join(directory,'package')],env);
    env.DESKTOP_TEST_EXECUTABLE=join(directory,'package','win-unpacked','Baccarat Live Analyzer.exe');
  }else delete env.DESKTOP_TEST_EXECUTABLE;
  await run(['node_modules/@playwright/test/cli.js','test','license.spec.ts','--reporter=list,github'],env);
}finally{
  await new Promise(resolve=>server.close(resolve));store.close();
  // Restore review build so no temporary trust configuration reaches artifacts.
  const clean={...process.env};delete clean.LICENSE_CONFIG_FILE;delete clean.REQUIRE_LICENSE_BUILD;
  await run(['scripts/build.mjs'],clean);rmSync(directory,{recursive:true,force:true});
}
