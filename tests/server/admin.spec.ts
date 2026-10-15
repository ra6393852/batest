import {test as base,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {type LicenseStore} from '../../src/license-server/store';
import {addMonthsKorea,type LicenseRequest} from '../../src/licensing/protocol';
const library=createRequire(import.meta.url)('../../dist/license-server/library.cjs') as typeof import('../../src/license-server/library');
type Fixture={url:string;password:string;store:LicenseStore;item:{id:string;code:string};request:(code:string)=>LicenseRequest;advance:(ms:number)=>void};
const test=base.extend<{seller:Fixture}>({seller:async({},use)=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-admin-ui-')),password=randomUUID();library.initialize(folder,'http://127.0.0.1',password);const settings=library.readSettings(folder);let now=Date.now();const store=new library.LicenseStore(join(folder,'licenses.sqlite'),settings.privateKey,()=>now),server=library.createLicenseServer(store,settings,folder,()=>now);
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));settings.url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const device=generateKeyPairSync('ed25519'),publicKey=device.publicKey.export({format:'pem',type:'spki'}).toString(),sessionId=randomUUID(),item=store.issue(1,1,'관리 동작 확인').rows[0];
  const request=(code:string):LicenseRequest=>({action:'activate',code,licenseId:item.id,publicKey,sessionId,requestId:randomUUID(),nonce:'a'.repeat(48)});store.apply(request(item.code));
  try{await use({url:settings.url,password,store,item,request,advance(ms){now+=ms;}});}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(folder,{recursive:true,force:true});}
}});
test.beforeEach(async({page,seller})=>{await page.goto(seller.url+'/admin');await page.locator('#password').fill(seller.password);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.locator('#rows tr')).toHaveCount(1);});
test('extend, cancel, reset and history work even when native confirmation dialogs are dismissed',async({page,seller})=>{
  page.on('dialog',d=>void d.dismiss());const row=page.locator('#rows tr');const before=Number(seller.store.list()[0].expires);
  await page.locator('#extend-months').selectOption('2');await row.getByRole('button',{name:'기간 연장',exact:true}).click();await expect(page.locator('#manage-description')).toContainText('2개월');await page.locator('#manage-cancel').click();expect(seller.store.list()[0].expires).toBe(before);
  await row.getByRole('button',{name:'기간 연장',exact:true}).click();await page.locator('#manage-confirm').click();await expect(page.locator('#manage-message')).toContainText('2개월 연장했습니다');expect(seller.store.list()[0].expires).toBe(addMonthsKorea(before,2));await page.locator('#manage-cancel').click();
  await row.getByRole('button',{name:'PC 등록 해제',exact:true}).click();await page.locator('#manage-confirm').click();await expect(page.locator('#manage-message')).toContainText('PC 등록을 해제했습니다');expect(seller.store.list()[0].device).toBeNull();expect(seller.store.list()[0].expires).toBe(addMonthsKorea(before,2));await page.locator('#manage-cancel').click();await expect(row.locator('td').nth(2)).toHaveText('미등록');
  await row.getByRole('button',{name:'변경 이력',exact:true}).click();await expect(page.locator('#history')).toContainText('admin-reset');await expect(page.locator('#history')).toContainText('extend');
});
test('reissue displays only the new code to copy, revokes old code, preserves expiry/PC and survives a page reload',async({page,seller})=>{
  const before=seller.store.list()[0];await page.locator('#rows tr').getByRole('button',{name:'코드 재발급',exact:true}).click();await page.getByRole('button',{name:'새 코드 발급',exact:true}).click();await expect(page.locator('#manage-title')).toHaveText('코드 재발급 완료');const code=await page.getByLabel('손님에게 전달할 새 이용 코드',{exact:true}).inputValue();expect(code).toMatch(/^BLA-/);expect(code).not.toBe(seller.item.code);
  expect(()=>seller.store.apply(seller.request(seller.item.code))).toThrow('올바르지');expect(()=>seller.store.apply(seller.request(code))).not.toThrow();expect(seller.store.list()[0]).toMatchObject({expires:before.expires,device:before.device,activated:before.activated});
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:seller.url});await page.getByRole('button',{name:'새 코드 복사',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
  await page.locator('#manage-cancel').click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'발급 CSV 다운로드',exact:true}).click();expect((await download).suggestedFilename()).toContain('발급코드');
  await page.reload();await expect(page.locator('#rows')).toContainText(code.slice(-8));await expect(page.locator('#codes')).toBeEmpty();
  await page.locator('#rows tr').getByRole('button',{name:'코드 재발급',exact:true}).click();await page.getByRole('button',{name:'새 코드 발급',exact:true}).click();await expect(page.locator('#manage-title')).toHaveText('코드 재발급 완료');const second=await page.locator('#replacement-code').inputValue();expect(second).not.toBe(code);expect(()=>seller.store.apply(seller.request(code))).toThrow('올바르지');expect(()=>seller.store.apply(seller.request(second))).not.toThrow();
});
test('errors stay visible in the confirmation window, and expired login returns to a usable password screen',async({page,seller})=>{
  const before=seller.store.list()[0];await page.route('**/admin/manage',route=>route.abort());await page.locator('#rows tr').getByRole('button',{name:'기간 연장',exact:true}).click();await page.locator('#manage-confirm').click();await expect(page.locator('#manage-message')).toContainText('서버에 연결하지 못했습니다');expect(seller.store.list()[0].expires).toBe(before.expires);await expect(page.locator('#manage-confirm')).toBeEnabled();await page.locator('#manage-cancel').click();await page.unroute('**/admin/manage');
  seller.advance(3600001);await page.locator('#rows tr').getByRole('button',{name:'PC 등록 해제',exact:true}).click();await page.locator('#manage-confirm').click();await expect(page.locator('#manage-dialog')).not.toBeVisible();await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#message')).toContainText('로그인이 필요');await page.locator('#password').fill(seller.password);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.locator('#dashboard')).toBeVisible();
});
