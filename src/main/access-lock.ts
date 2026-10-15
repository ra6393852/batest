import {scrypt,timingSafeEqual} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,relative,isAbsolute,sep} from 'node:path';
import type {AccessStatus} from '../shared/types';
export interface PasswordVerifier {salt:string;digest:string}
export function passwordKey(password:string,salt:string):Promise<Buffer>{
  return new Promise((resolve,reject)=>scrypt(password,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1},(error,key)=>error?reject(error):resolve(key)));
}
// Test credentials can only be used with a separate temporary fixture profile.
export function isolatedTestDirectory(path:string):string {
  const actual=realpathSync(path),root=realpathSync(tmpdir()),child=relative(root,actual);
  if(!child||isAbsolute(child)||child==='..'||child.startsWith(`..${sep}`)||!basename(actual).startsWith('baccarat-'))
    throw new Error('Smoke test requires a temporary baccarat- fixture directory');
  return actual;
}
export class AccessLock {
  private locked=true;
  private busy=false;
  private attempts=0;
  private nextAttempt=0;
  constructor(private verifier:PasswordVerifier,private clock=()=>Date.now()) {
    if(!/^[a-f0-9]{32}$/.test(verifier.salt)||!/^[a-f0-9]{64}$/.test(verifier.digest))throw new Error('Invalid password verifier');
  }
  status():AccessStatus {return {locked:this.locked,retryAfterMs:this.locked?Math.max(0,this.nextAttempt-this.clock()):0};}
  async unlock(password:unknown):Promise<AccessStatus> {
    if(!this.locked||this.busy||this.status().retryAfterMs)return this.status();
    if(typeof password!=='string'||!password.length||password.length>128)return this.status();
    this.busy=true;
    try{
      const key=await passwordKey(password,this.verifier.salt);
      if(timingSafeEqual(key,Buffer.from(this.verifier.digest,'hex'))){this.locked=false;this.attempts=0;}
      else{this.attempts++;if(this.attempts>=5)this.nextAttempt=this.clock()+Math.min(30000,(this.attempts-4)*5000);}
      return this.status();
    }finally{this.busy=false;}
  }
}
