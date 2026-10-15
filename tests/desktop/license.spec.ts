import {test,expect,_electron as electron,chromium,type ElectronApplication} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('customer build pins server: registration, no password bypass, PC denial, release, restart, extend, block and expiry',async()=>{
  test.setTimeout(120000);
  const info=JSON.parse(readFileSync(process.env.LICENSE_E2E_INFO!,'utf8')) as {url:string;password:string;item:{id:string;code:string};clockFile:string};
  let cookie='';const admin=async(path:string,data?:unknown)=>{const response=await fetch(info.url+'/admin/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:info.url,Cookie:cookie},...(data===undefined?{}:{body:JSON.stringify(data)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];expect(response.ok).toBe(true);return response.json();};
  const advance=(ms:number)=>writeFileSync(info.clockFile,String(Number(readFileSync(info.clockFile,'utf8'))+ms));
  const aDir=mkdtempSync(join(tmpdir(),'baccarat-customer-a-')),bDir=mkdtempSync(join(tmpdir(),'baccarat-customer-b-'));
  const launch=(folder:string)=>electron.launch({executablePath:process.env.DESKTOP_TEST_EXECUTABLE,args:['.','--smoke-test',`--test-data=${folder}`],env:{...process.env,DESKTOP_TEST_PASSWORD:'fixture-cannot-bypass-license',LICENSE_CONFIG_FILE:'invalid-runtime-override'}});
  let a:ElectronApplication|undefined,b:ElectronApplication|undefined;
  try{
    a=await launch(aDir);let page=await a.firstWindow();await expect(page.getByLabel('이용 코드',{exact:true})).toBeVisible();
    await page.evaluate(()=>window.analyzer.unlock('fixture-cannot-bypass-license'));
    const denied=await page.evaluate(async()=>{try{await window.analyzer.snapshot();return false;}catch{return true;}});expect(denied).toBe(true);
    await page.getByLabel('이용 코드',{exact:true}).fill(info.item.code);await page.getByRole('button',{name:'이 PC에 등록',exact:true}).click();
    await expect(page.getByRole('button',{name:'게임 창 선택',exact:true})).toBeVisible();
    // Register history so release/block/expiry can be checked without losing records.
    const saved=await page.evaluate(async()=>{const r=await window.analyzer.reviewSequence('BPT');const x=await window.analyzer.saveImage({reviewId:r.id,roomName:'license history',shoeId:'one',startRound:1,outcomes:r.outcomes,tiesAfter:[]});return x;});expect(saved.added).toBe(3);
    b=await launch(bDir);const other=await b.firstWindow();await other.getByLabel('이용 코드',{exact:true}).fill(info.item.code);await other.getByRole('button',{name:'이 PC에 등록',exact:true}).click();await expect(other.getByTestId('license-message')).toContainText('다른 PC');
    await page.getByRole('button',{name:'이용권·PC 등록',exact:true}).click();await expect(page.getByTestId('license-id')).toHaveText(info.item.id);
    const expiry=await page.getByTestId('license-expiry').textContent();expect(expiry).toBeTruthy();
    await a.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
    await page.getByRole('button',{name:'이 PC 등록 해제',exact:true}).click();await expect(page.getByTestId('license-message')).toContainText('등록을 해제');
    advance(120001);await other.getByRole('button',{name:'이 PC에 등록',exact:true}).click();await expect(other.getByRole('button',{name:'게임 창 선택',exact:true})).toBeVisible();
    await b.close();b=await launch(bDir);const restored=await b.firstWindow();await expect(restored.getByRole('button',{name:'게임 창 선택',exact:true})).toBeVisible();
    await admin('login',{password:info.password});await admin('manage',{id:info.item.id,action:'extend',months:12});
    expect((await restored.evaluate(()=>window.analyzer.refreshLicense())).allowed).toBe(true);
    await admin('manage',{id:info.item.id,action:'block'});await restored.evaluate(()=>window.analyzer.refreshLicense());await expect(restored.getByTestId('license-message')).toContainText('차단');
    await admin('manage',{id:info.item.id,action:'unblock'});await admin('manage',{id:info.item.id,action:'reset'});advance(120001);
    await page.getByLabel('이용 코드',{exact:true}).fill(info.item.code);await page.getByRole('button',{name:'이 PC에 등록',exact:true}).click();await expect(page.getByTestId('total-results')).toHaveText('3');
    advance(500*86400000);await page.evaluate(()=>window.analyzer.refreshLicense());await expect(page.getByTestId('license-message')).toContainText('만료');
    await admin('manage',{id:info.item.id,action:'extend',months:1});advance(120001);await page.getByRole('button',{name:'기존 등록 다시 확인',exact:true}).click();await expect(page.getByTestId('total-results')).toHaveText('3');
  }finally{await a?.close();await b?.close();rmSync(aDir,{recursive:true,force:true});rmSync(bDir,{recursive:true,force:true});}
});
test('seller browser can select twelve months, issue/download codes and manage devices',async()=>{
  const info=JSON.parse(readFileSync(process.env.LICENSE_E2E_INFO!,'utf8')) as {url:string;password:string};
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();await page.goto(info.url+'/admin');await page.locator('#password').fill(info.password);await page.getByRole('button',{name:'로그인',exact:true}).click();
    await expect(page.locator('#dashboard')).toBeVisible();await expect(page.locator('#months option')).toHaveCount(12);
    await page.locator('#months').selectOption('12');await page.locator('#count').fill('2');await page.locator('#customer').fill('seller UI verification');await page.getByRole('button',{name:'코드 생성',exact:true}).click();
    await expect(page.locator('#codes')).toContainText('12개월');expect((await page.locator('#codes').textContent())!.match(/BLA-/g)).toHaveLength(2);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'발급 CSV 다운로드',exact:true}).click();expect((await download).suggestedFilename()).toContain('발급코드');
    await page.locator('#query').fill('seller UI verification');await page.getByRole('button',{name:'검색',exact:true}).click();await expect(page.locator('#rows tr')).toHaveCount(2);
    page.on('dialog',d=>void d.accept());await page.locator('#rows tr').first().getByRole('button',{name:'사용 차단',exact:true}).click();await expect(page.locator('#rows tr').first()).toContainText('차단');
    await page.locator('#rows tr').first().getByRole('button',{name:'차단 해제',exact:true}).click();await expect(page.locator('#rows tr').first()).toContainText('미사용');
    await page.locator('#rows tr').first().getByRole('button',{name:'변경 이력',exact:true}).click();await expect(page.locator('#history')).toContainText('unblock');
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();await expect(page.locator('#login')).toBeVisible();
  }finally{await browser.close();}
});
