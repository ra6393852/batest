import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Does not register or consume a real customer's code on the CI machine.
test('configured customer EXE starts with code registration and denies analysis/password bypass',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-customer-release-'));let app:ElectronApplication|undefined;
  try{
    app=await electron.launch({executablePath:process.env.DESKTOP_TEST_EXECUTABLE,args:['.','--smoke-test',`--test-data=${folder}`],env:{...process.env,DESKTOP_TEST_PASSWORD:'release-fixture-no-bypass',LICENSE_CONFIG_FILE:'runtime-override-is-not-trusted'}});
    const page=await app.firstWindow();await expect(page.getByLabel('이용 코드',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>window.analyzer.licenseStatus())).toMatchObject({mode:'licensed',allowed:false});
    await page.evaluate(()=>window.analyzer.unlock('release-fixture-no-bypass'));
    expect(await page.evaluate(async()=>{try{await window.analyzer.snapshot();return false;}catch{return true;}})).toBe(true);
    await expect(page.getByRole('button',{name:'게임 창 선택',exact:true})).toHaveCount(0);
  }finally{await app?.close();rmSync(folder,{recursive:true,force:true});}
});
