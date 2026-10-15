import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {checkConfig,deviceId,signedRequest,verifyLease,type LicenseAction,type LicenseConfig,type LicenseLease} from '../licensing/protocol';
import type {LicenseStatus} from '../shared/types';
interface Device {publicKey:string;privateKey:string;licenseId?:string}
export interface SecretStorage {encrypt(value:string):Buffer;decrypt(value:Buffer):string}
export class LicenseClient {
  private config:LicenseConfig;
  private device?:Device;
  private session=randomUUID();
  private lease?:LicenseLease;
  private deadline=0;
  private state:LicenseStatus={mode:'licensed',allowed:false,message:'이용 코드를 등록하세요.'};
  private busy=false;
  private generation=0;
  constructor(config:LicenseConfig,private path:string,private secrets:SecretStorage,private notify:(status:LicenseStatus)=>void,private monotonic=()=>performance.now()){
    this.config=checkConfig(config);
    if(existsSync(path))try{this.device=JSON.parse(secrets.decrypt(readFileSync(path)));if(!this.device?.publicKey||!this.device.privateKey)throw Error();}catch{this.state.message='이 PC의 인증 정보를 읽지 못했습니다. 판매자에게 이전 PC 등록 해제를 요청한 뒤 다시 등록하세요.';}
  }
  status():LicenseStatus{return {...this.state,allowed:!!this.lease&&this.monotonic()<this.deadline,...(this.lease?{licenseId:this.lease.licenseId,expiresAt:new Date(this.lease.expiresAt).toISOString()}: {})};}
  require(){if(!this.status().allowed)throw new Error('유효한 이용 코드 인증이 필요합니다.');}
  private save(){mkdirSync(dirname(this.path),{recursive:true,mode:0o700});writeFileSync(this.path+'.tmp',this.secrets.encrypt(JSON.stringify(this.device)),{mode:0o600});renameSync(this.path+'.tmp',this.path);}
  private async post(path:string,data:unknown){const response=await fetch(this.config.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(8000),redirect:'error'});const result=await response.json() as {message?:string};if(!response.ok)throw new Error(result.message??'인증 서버가 요청을 거절했습니다.');return result;}
  private async proof(action:LicenseAction,code?:string){
    if(!this.device)throw new Error('PC 인증 정보가 없습니다.');
    const {nonce}=await this.post('/v1/challenge',{action,publicKey:this.device.publicKey}) as unknown as {nonce:string};
    return this.post('/v1/'+action,signedRequest({action,nonce,publicKey:this.device.publicKey,sessionId:this.session,...(code?{code}:{}),...(this.device.licenseId?{licenseId:this.device.licenseId}:{})},this.device.privateKey));
  }
  private fail(error:unknown){this.lease=undefined;this.deadline=0;this.state.message=error instanceof Error&&!(error instanceof TypeError)?error.message:'인증 서버에 연결하지 못했습니다. 인터넷 연결과 서버 상태를 확인하세요.';this.notify(this.status());}
  async activate(code:string){
    if(this.busy)throw new Error('인증 처리 중입니다.');this.busy=true;const generation=++this.generation;
    try{
      if(!/^BLA-(?:[A-Fa-f0-9]{8}-){3}[A-Fa-f0-9]{8}$/.test(code.trim()))throw new Error('전달받은 이용 코드를 정확히 입력하세요.');
      if(!this.device){const pair=generateKeyPairSync('ed25519');this.device={publicKey:pair.publicKey.export({format:'pem',type:'spki'}).toString(),privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString()};this.save();}
      // Do not lose the key if the response is interrupted after server registration.
      const started=this.monotonic(),raw=await this.proof('activate',code.trim().toUpperCase());
      if(generation!==this.generation)return this.status();this.accept(raw,started);this.device.licenseId=this.lease!.licenseId;this.save();
    }catch(error){this.fail(error);}finally{this.busy=false;}return this.status();
  }
  private accept(raw:unknown,started:number){const lease=verifyLease(raw,this.config.publicKey,deviceId(this.device!.publicKey),this.session);const remaining=lease.validUntil-lease.issuedAt-(this.monotonic()-started);if(remaining<=0)throw new Error('인증이 만료되었습니다. 다시 시도하세요.');this.lease=lease;this.deadline=this.monotonic()+remaining;this.state={mode:'licensed',allowed:true,message:'인증 완료 · 이 PC에 등록되었습니다.',licenseId:lease.licenseId,expiresAt:new Date(lease.expiresAt).toISOString()};this.notify(this.status());}
  async refresh(){
    if(this.busy)return this.status();
    if(!this.device?.licenseId){this.notify(this.status());return this.status();}
    this.busy=true;const generation=this.generation,started=this.monotonic();
    try{const raw=await this.proof('renew');if(generation===this.generation)this.accept(raw,started);}catch(error){if(generation===this.generation)this.fail(error);}finally{this.busy=false;}return this.status();
  }
  async deactivate(){
    if(this.busy)throw new Error('인증 처리 중입니다.');this.busy=true;
    try{await this.proof('deactivate');this.generation++;this.lease=undefined;this.deadline=0;this.device=undefined;try{unlinkSync(this.path);}catch{ /* a missing local file does not restore server registration */ }this.state={mode:'licensed',allowed:false,message:'PC 등록을 해제했습니다. 새 PC 등록까지 최대 2분 기다릴 수 있습니다. 기존 이용 기간은 유지됩니다.'};this.notify(this.status());return this.status();}finally{this.busy=false;}
  }
  async release(){this.generation++;this.lease=undefined;this.deadline=0;try{if(this.device?.licenseId)await this.proof('release');}catch{ /* the server session expires in at most two minutes */ }}
}
