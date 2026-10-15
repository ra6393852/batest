import {test,expect} from 'vitest';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LicenseStore} from '../../src/license-server/store';
import {createLicenseServer} from '../../src/license-server/server';
import {initialize,readSettings} from '../../src/license-server/settings';
import {type LicenseRequest} from '../../src/licensing/protocol';
const key=()=>{const pair=generateKeyPairSync('ed25519');return {privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),publicKey:pair.publicKey.export({format:'pem',type:'spki'}).toString()};};
test('reissue preserves active terms, device/session and cooldown; old codes are revoked and new credentials stay hash-only after restart',()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-reissue-')),path=join(folder,'licenses.sqlite'),signer=key(),device=key();let now=Date.now(),store=new LicenseStore(path,signer.privateKey,()=>now);
  try{
    const original=store.issue(3,1,'existing customer').rows[0],sessionId=randomUUID();
    const request=(code:string,action:LicenseRequest['action']='activate',publicKey=device.publicKey):LicenseRequest=>({action,code,licenseId:original.id,publicKey,nonce:'a'.repeat(48),requestId:randomUUID(),sessionId});
    store.apply(request(original.code));store.manage(original.id,'extend',2);
    const before=store.db.prepare('SELECT * FROM licenses WHERE id=?').get(original.id)!;
    const replacement=store.reissue(original.id),after=store.db.prepare('SELECT * FROM licenses WHERE id=?').get(original.id)!;
    const {code_hash:oldHash,code_hint:oldHint,...oldState}=before,{code_hash:newHash,code_hint:newHint,...newState}=after;
    expect(newState).toEqual(oldState);expect(newHash).not.toBe(oldHash);expect(newHint).toBe(replacement.code.slice(-8));
    expect(replacement.code).toMatch(/^BLA-(?:[0-9A-F]{8}-){3}[0-9A-F]{8}$/);expect(()=>store.apply(request(original.code))).toThrow('올바르지');
    expect(()=>store.apply(request(replacement.code,'activate',key().publicKey))).toThrow('다른 PC');
    expect(()=>store.apply(request(replacement.code,'renew'))).not.toThrow();
    expect(JSON.stringify(store.db.prepare('SELECT * FROM licenses').all())).not.toContain(replacement.code);
    expect(JSON.stringify(store.history(original.id))).not.toContain(replacement.code);expect(JSON.stringify(store.history(original.id))).not.toContain(original.code);
    store.manage(original.id,'reset');const cooldown=store.db.prepare('SELECT registration_after FROM licenses WHERE id=?').get(original.id)!.registration_after;
    const next=store.reissue(original.id);expect(store.db.prepare('SELECT registration_after FROM licenses WHERE id=?').get(original.id)!.registration_after).toBe(cooldown);
    expect(()=>store.apply(request(next.code))).toThrow('최대 2분');now+=120001;
    store.close();store=new LicenseStore(path,signer.privateKey,()=>now);
    expect(()=>store.apply(request(replacement.code))).toThrow('올바르지');expect(()=>store.apply(request(next.code))).not.toThrow();
    expect(store.list()[0].expires).toBe(before.expires);
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
test('reissue never activates an unused license or removes blocked/expired state',()=>{
  const signer=key(),device=key();let now=Date.now();const store=new LicenseStore(':memory:',signer.privateKey,()=>now);
  try{
    const item=store.issue(1,1,'').rows[0],unused=store.reissue(item.id);
    expect(store.list()[0]).toMatchObject({activated:null,expires:null,device:null,status:'unused'});
    const request=(code:string):LicenseRequest=>({action:'activate',code,publicKey:device.publicKey,sessionId:randomUUID(),requestId:randomUUID(),nonce:'b'.repeat(48)});
    store.apply(request(unused.code));store.manage(item.id,'block');const blocked=store.reissue(item.id);
    expect(()=>store.apply(request(blocked.code))).toThrow('차단');const expires=Number(store.list()[0].expires);
    store.manage(item.id,'unblock');now=expires+1;const expired=store.reissue(item.id);
    expect(()=>store.apply(request(expired.code))).toThrow('만료');expect(store.list()[0].expires).toBe(expires);
  }finally{store.close();}
});
test('reissue HTTP requires authenticated same-origin POST, and list/history never reveal the new full code',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-reissue-http-')),password=randomUUID();initialize(folder,'http://127.0.0.1',password);const settings=readSettings(folder),store=new LicenseStore(join(folder,'licenses.sqlite'),settings.privateKey),server=createLicenseServer(store,settings);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));settings.url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const item=store.issue(1,1,'http reissue').rows[0];let cookie='';
  const post=async(path:string,body:unknown,origin=settings.url)=>{const response=await fetch(settings.url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];return {status:response.status,data:await response.json()};};
  try{
    expect((await post('/admin/reissue',{id:item.id})).status).toBe(401);await post('/admin/login',{password});
    expect((await post('/admin/reissue',{id:item.id},'https://other.example')).status).toBe(403);
    expect((await post('/admin/reissue',{id:'invalid'})).status).toBe(400);
    expect((await post('/admin/reissue',{id:randomUUID()})).status).toBe(403);
    const result=await post('/admin/reissue',{id:item.id});expect(result.status).toBe(200);expect(result.data.code).not.toBe(item.code);
    const listed=await (await fetch(settings.url+'/admin/licenses',{headers:{Cookie:cookie}})).text();expect(listed).not.toContain(result.data.code);expect(listed).toContain(result.data.code.slice(-8));
    const history=await (await fetch(settings.url+'/admin/history?id='+item.id,{headers:{Cookie:cookie}})).text();expect(history).toContain('reissue');expect(history).not.toContain(result.data.code);
  }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(folder,{recursive:true,force:true});}
});
