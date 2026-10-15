import {createHash,createPublicKey,sign,verify} from 'node:crypto';
import {z} from 'zod';
export const serverConfigSchema=z.object({url:z.string().url().max(500),publicKey:z.string().min(40).max(200)}).strict();
export type LicenseConfig=z.infer<typeof serverConfigSchema>;
export function checkConfig(raw:unknown):LicenseConfig {
  const config=serverConfigSchema.parse(raw),url=new URL(config.url);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('HTTPS 인증 서버 주소가 필요합니다.');
  if(createPublicKey(config.publicKey).asymmetricKeyType!=='ed25519')throw new Error('Ed25519 공개 키가 필요합니다.');
  return {...config,url:url.origin};
}
export const actions=['activate','renew','deactivate','release'] as const;
export type LicenseAction=typeof actions[number];
export const requestSchema=z.object({action:z.enum(actions),nonce:z.string().regex(/^[a-f0-9]{48}$/),publicKey:z.string().min(40).max(200),sessionId:z.uuid(),code:z.string().max(100).optional(),licenseId:z.uuid().optional()}).strict();
export type LicenseRequest=z.infer<typeof requestSchema>;
export function requestBytes(input:LicenseRequest){return Buffer.from(JSON.stringify([input.action,input.nonce,input.publicKey,input.sessionId,input.code??null,input.licenseId??null]));}
export function deviceId(publicKey:string){return createHash('sha256').update(publicKey).digest('hex');}
export function codeHash(code:string){return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');}
export function signedRequest(input:LicenseRequest,privateKey:string){return {request:input,signature:sign(null,requestBytes(input),privateKey).toString('base64')};}
export function verifyRequest(input:LicenseRequest,signature:string){try{return createPublicKey(input.publicKey).asymmetricKeyType==='ed25519'&&verify(null,requestBytes(input),input.publicKey,Buffer.from(signature,'base64'));}catch{return false;}}
export const leaseSchema=z.object({licenseId:z.uuid(),deviceId:z.string().regex(/^[a-f0-9]{64}$/),sessionId:z.uuid(),issuedAt:z.number().int(),validUntil:z.number().int(),expiresAt:z.number().int()}).strict();
export type LicenseLease=z.infer<typeof leaseSchema>;
export interface SignedLease {lease:LicenseLease;signature:string}
export function signLease(lease:LicenseLease,key:string):SignedLease{return {lease,signature:sign(null,Buffer.from(JSON.stringify(lease)),key).toString('base64')};}
export function verifyLease(raw:unknown,key:string,device:string,session:string):LicenseLease {
  const data=z.object({lease:leaseSchema,signature:z.string().max(200)}).strict().parse(raw),l=data.lease;
  if(!verify(null,Buffer.from(JSON.stringify(l)),key,Buffer.from(data.signature,'base64'))||l.deviceId!==device||l.sessionId!==session||l.validUntil<=l.issuedAt||l.validUntil-l.issuedAt>120000||l.expiresAt<l.validUntil)throw new Error('유효한 서버 인증이 아닙니다.');
  return l;
}
// Korean calendar months; a missing day in the target month is clamped to month end.
export function addMonthsKorea(timestamp:number,months:number){
  if(!Number.isInteger(months)||months<1||months>12)throw new Error('이용 기간은 1~12개월입니다.');
  const date=new Date(timestamp+9*3600000),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.getTime()-9*3600000;
}
