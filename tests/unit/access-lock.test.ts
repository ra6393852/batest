import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccessLock,passwordKey,isolatedTestDirectory} from '../../src/main/access-lock';
const fixture='unit-fixture-password',salt='00112233445566778899aabbccddeeff';
const verifier=async()=>({salt,digest:(await passwordKey(fixture,salt)).toString('hex')});
describe('application access lock',()=>{
  it('starts locked, rejects wrong passwords, unlocks the correct password and relocks after restart',async()=>{
    const v=await verifier(),lock=new AccessLock(v);expect(lock.status().locked).toBe(true);
    expect((await lock.unlock('wrong')).locked).toBe(true);expect((await lock.unlock(fixture)).locked).toBe(false);
    expect(new AccessLock(v).status().locked).toBe(true);
  });
  it('rate limits repeated wrong attempts and accepts a retry after the delay',async()=>{
    let now=1000;const lock=new AccessLock(await verifier(),()=>now);
    for(let i=0;i<5;i++)await lock.unlock('wrong');expect(lock.status().retryAfterMs).toBe(5000);
    expect((await lock.unlock(fixture)).locked).toBe(true);now+=5000;expect((await lock.unlock(fixture)).locked).toBe(false);
  });
  it('rejects invalid verifiers and allows fixture credentials only in a temporary profile',()=>{
    expect(()=>new AccessLock({salt:'invalid',digest:'invalid'})).toThrow();
    const folder=mkdtempSync(join(tmpdir(),'baccarat-access-'));
    try{expect(isolatedTestDirectory(folder)).toBeTruthy();expect(()=>isolatedTestDirectory(process.cwd())).toThrow();expect(()=>isolatedTestDirectory(tmpdir())).toThrow();}
    finally{rmSync(folder,{recursive:true,force:true});}
  });
});
