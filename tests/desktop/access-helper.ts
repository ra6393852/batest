import {randomBytes} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
// Random fixture credential, only for the isolated --smoke-test profile.
// The production admin password is never included in source or test logs.
process.env.DESKTOP_TEST_PASSWORD??=randomBytes(24).toString('hex');
export async function unlockApp(page:Page){
  await expect(page.getByLabel('관리자 암호',{exact:true})).toBeVisible();
  await page.getByLabel('관리자 암호',{exact:true}).fill(process.env.DESKTOP_TEST_PASSWORD!);
  await page.getByRole('button',{name:'잠금 해제',exact:true}).click();
  await expect(page.getByLabel('관리자 암호',{exact:true})).toHaveCount(0);
}
