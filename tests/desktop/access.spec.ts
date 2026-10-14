import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {unlockApp} from './access-helper';
test('startup password protects snapshot, clipboard, capture and browser APIs and relocks on restart',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-access-'));let app:ElectronApplication|undefined;
  const launch=()=>electron.launch({executablePath:process.env.DESKTOP_TEST_EXECUTABLE,args:['.','--smoke-test',`--test-data=${folder}`,
    ...(process.platform==='linux'&&process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST==='1'?['--no-sandbox']:[])]});
  try{
    app=await launch();let page=await app.firstWindow();await expect(page.getByLabel('관리자 암호',{exact:true})).toBeVisible();
    expect(await page.getByLabel('관리자 암호',{exact:true}).getAttribute('type')).toBe('password');
    await expect(page.getByRole('button',{name:'게임 창 선택',exact:true})).toHaveCount(0);
    const errors=await page.evaluate(async()=>{
      const actions=[()=>window.analyzer.snapshot(),()=>window.analyzer.captureWindows(),()=>window.analyzer.captureStart('window:1:0'),
        ()=>window.analyzer.pasteImage(),()=>window.analyzer.reviewSequence('BPT'),()=>window.analyzer.open('demo'),()=>window.analyzer.exportCSV('r','s')];
      return Promise.all(actions.map(async action=>{try{await action();return '';}catch(error){return String(error);}}));
    });
    expect(errors.every(e=>e.includes('관리자 암호'))).toBe(true);
    await page.getByLabel('관리자 암호',{exact:true}).fill('incorrect');await page.getByRole('button',{name:'잠금 해제',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveText('암호가 일치하지 않습니다.');expect((await page.evaluate(()=>window.analyzer.accessStatus())).locked).toBe(true);
    await unlockApp(page);expect((await page.evaluate(()=>window.analyzer.snapshot())).results).toHaveLength(0);
    await app.close();app=await launch();page=await app.firstWindow();await expect(page.getByLabel('관리자 암호',{exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.analyzer.accessStatus())).locked).toBe(true);
    await unlockApp(page);await expect(page.getByRole('button',{name:'게임 창 선택',exact:true})).toBeVisible();
  }finally{await app?.close();rmSync(folder,{recursive:true,force:true});}
});
