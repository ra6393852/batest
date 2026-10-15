import {describe,test,expect} from 'vitest';
import {generateKeyPairSync,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addMonthsKorea,deviceId,signedRequest,verifyLease,checkConfig,type LicenseRequest} from '../../src/licensing/protocol';
import {LicenseStore} from '../../src/license-server/store';
import {createLicenseServer} from '../../src/license-server/server';
import {initialize,readSettings} from '../../src/license-server/settings';
import {LicenseClient,type SecretStorage} from '../../src/main/license-client';
function keys(){const p=generateKeyPairSync('ed25519');return {publicKey:p.publicKey.export({format:'pem',type:'spki'}).toString(),privateKey:p.privateKey.export({format:'pem',type:'pkcs8'}).toString()};}
const base=Date.parse('2026-10-15T03:00:00Z');
function vault():SecretStorage {const key=randomBytes(32);return {encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decrypt(value){const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString();}};}
describe('license terms, binding and immutable expiry',()=>{
  test('all 1–12 calendar months, Korean month end and leap years',()=>{
    for(let months=1;months<=12;months++){const actual=new Date(addMonthsKorea(base,months));expect(actual.getUTCHours()).toBe(3);expect(actual.getUTCDate()).toBe(15);expect(actual.getUTCMonth()).toBe((9+months)%12);}
    expect(new Date(addMonthsKorea(Date.parse('2027-01-31T14:59:59Z'),1)).toISOString()).toBe('2027-02-28T14:59:59.000Z');
    expect(new Date(addMonthsKorea(Date.parse('2028-01-31T14:59:59Z'),1)).toISOString()).toBe('2028-02-29T14:59:59.000Z');
    expect(new Date(addMonthsKorea(Date.parse('2026-01-31T18:00:00Z'),1)).toISOString()).toBe('2026-02-28T18:00:00.000Z');
    for(const n of [0,13,1.5])expect(()=>addMonthsKorea(base,n)).toThrow();
  });
  test('10,000 unique codes are hash-only, persistent and inactive before first use',()=>{
    const directory=mkdtempSync(join(tmpdir(),'baccarat-codes-')),key=keys();let store:LicenseStore|undefined;
    try{store=new LicenseStore(join(directory,'server.sqlite'),key.privateKey,()=>base);const batch=store.issue(12,10000,'고객');expect(new Set(batch.rows.map(r=>r.code)).size).toBe(10000);expect(store.list()).toHaveLength(100);expect(store.list('',9990)).toHaveLength(10);
      expect(store.list().every(r=>r.activated===null&&r.expires===null)).toBe(true);const dump=JSON.stringify(store.db.prepare('SELECT * FROM licenses').all());expect(dump).not.toContain(batch.rows[0].code);store.close();store=undefined;
      store=new LicenseStore(join(directory,'server.sqlite'),key.privateKey,()=>base);expect(store.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()?.n).toBe(10000);
    }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
  });
  test('one PC/session, transfer cooldown, customer/admin release, expiry, extension and audit',()=>{
    const key=keys(),a=keys(),b=keys();let now=base;const store=new LicenseStore(':memory:',key.privateKey,()=>now),item=store.issue(3,1,'customer').rows[0];
    const req=(action:LicenseRequest['action'],who=a,sessionId='11111111-1111-4111-8111-111111111111'):LicenseRequest=>({action,publicKey:who.publicKey,sessionId,nonce:'a'.repeat(48),code:item.code,licenseId:item.id});
    try{
      const first=store.apply(req('activate'));const lease=verifyLease(first,key.publicKey,deviceId(a.publicKey),req('activate').sessionId);expect(lease.expiresAt).toBe(addMonthsKorea(base,3));
      expect(()=>store.apply(req('activate',b))).toThrow('다른 PC');expect(()=>store.apply(req('activate',a,randomUUID()))).toThrow('이미 실행');
      store.apply(req('release'));expect(store.list()[0].device).toBe(deviceId(a.publicKey));store.apply(req('activate',a));
      store.apply(req('deactivate'));expect(()=>store.apply(req('activate',b))).toThrow('최대 2분');now+=120001;
      const moved=store.apply(req('activate',b));expect(verifyLease(moved,key.publicKey,deviceId(b.publicKey),req('activate').sessionId).expiresAt).toBe(lease.expiresAt);expect(()=>store.apply(req('renew',a))).toThrow('다른 PC');
      store.manage(item.id,'reset');expect(()=>store.apply(req('renew',b))).toThrow('해제');now+=120001;store.apply(req('activate',a));
      store.manage(item.id,'extend',2);expect(store.list()[0].expires).toBe(addMonthsKorea(lease.expiresAt,2));store.manage(item.id,'block');expect(()=>store.apply(req('renew'))).toThrow('차단');
      store.manage(item.id,'unblock');now=Number(store.list()[0].expires);expect(()=>store.apply(req('renew'))).toThrow('만료');store.manage(item.id,'extend',12);expect(store.list()[0].expires).toBe(addMonthsKorea(now,12));
      expect(store.history(item.id).map(r=>r.action)).toContain('admin-reset');
    }finally{store.close();}
  });
  test('tampered server signatures and insecure server config are rejected',()=>{
    const key=keys();expect(()=>checkConfig({url:'http://public.example',publicKey:key.publicKey})).toThrow();expect(()=>checkConfig({url:'https://user:pass@example.com/',publicKey:key.publicKey})).toThrow();
    const store=new LicenseStore(':memory:',key.privateKey,()=>base),item=store.issue(1,1,'').rows[0],a=keys(),sessionId=randomUUID();
    try{const raw=store.apply({action:'activate',publicKey:a.publicKey,sessionId,nonce:'a'.repeat(48),code:item.code}) as {lease:{expiresAt:number};signature:string};raw.lease.expiresAt+=999999;expect(()=>verifyLease(raw,key.publicKey,deviceId(a.publicKey),sessionId)).toThrow();}finally{store.close();}
  });
});
test('real HTTP admin auth/CSRF, signed nonce replay rejection, protected client restart, copy denial and fail-closed refresh',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'baccarat-license-')),password=randomBytes(24).toString('hex');initialize(directory,'http://127.0.0.1',password);const settings=readSettings(directory);let now=base;
  const store=new LicenseStore(join(directory,'licenses.sqlite'),settings.privateKey,()=>now),server=createLicenseServer(store,settings,directory,()=>now);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));settings.url='http://127.0.0.1:'+((server.address() as {port:number}).port);
  const config={url:settings.url,publicKey:settings.publicKey};let cookie='';
  const api=async(path:string,data?:unknown,origin=settings.url)=>{const response=await fetch(settings.url+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},...(data===undefined?{}:{body:JSON.stringify(data)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];return {response,data:await response.json()};};
  try{
    expect((await api('/admin/issue',{months:1,count:1,customer:''})).response.status).toBe(401);
    expect((await api('/admin/login',{password},'https://attacker.example')).response.status).toBe(403);
    expect((await api('/admin/login',{password})).response.status).toBe(200);expect(cookie).toMatch(/^bla_admin=/);
    expect((await api('/admin/issue',{months:13,count:1,customer:''})).response.status).toBe(400);
    const issued=(await api('/admin/issue',{months:12,count:1,customer:'test'})).data.rows[0];
    const aKey=keys(),nonce=(await api('/v1/challenge',{publicKey:aKey.publicKey,action:'activate'})).data.nonce;
    const proof=signedRequest({action:'activate',nonce,publicKey:aKey.publicKey,sessionId:randomUUID(),code:issued.code},aKey.privateKey);
    expect((await api('/v1/activate',proof)).response.status).toBe(200);expect((await api('/v1/activate',proof)).response.status).toBe(403);
    await api('/admin/manage',{id:issued.id,action:'reset'});now+=120001;
    const encrypted=vault(),aPath=join(directory,'a.dat'),a=new LicenseClient(config,aPath,encrypted,()=>{});expect((await a.activate(issued.code)).allowed).toBe(true);
    expect(readFileSync(aPath).toString()).not.toContain('PRIVATE KEY');expect(readFileSync(aPath).toString()).not.toContain(issued.code);
    const bPath=join(directory,'b.dat');copyFileSync(aPath,bPath);const b=new LicenseClient(config,bPath,vault(),()=>{});expect((await b.refresh()).allowed).toBe(false);expect((await b.activate(issued.code)).message).toContain('다른 PC');
    await a.release();const reopened=new LicenseClient(config,aPath,encrypted,()=>{});expect((await reopened.refresh()).allowed).toBe(true);
    await reopened.deactivate();expect(reopened.status().allowed).toBe(false);now+=120001;expect((await b.activate(issued.code)).allowed).toBe(true);
    await api('/admin/manage',{id:issued.id,action:'block'});expect((await b.refresh()).allowed).toBe(false);expect(b.status().message).toContain('차단');expect(()=>b.require()).toThrow();
    await api('/admin/manage',{id:issued.id,action:'unblock'});now+=120001;expect((await b.activate(issued.code)).allowed).toBe(true);
    await new Promise<void>(resolve=>server.close(()=>resolve()));expect((await b.refresh()).allowed).toBe(false);expect(()=>b.require()).toThrow();
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(directory,{recursive:true,force:true});}
});
