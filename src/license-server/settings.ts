import {generateKeyPairSync,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {checkConfig} from '../licensing/protocol';
export interface ServerSettings {privateKey:string;publicKey:string;url:string;salt:string;passwordHash:string}
export function passwordDigest(password:string,salt:string){return scryptSync(password,Buffer.from(salt,'hex'),32).toString('hex');}
export function setPassword(settings:ServerSettings,password:string){if(password.length<12||password.length>128)throw new Error('관리자 암호는 12~128자로 설정하세요.');settings.salt=randomBytes(16).toString('hex');settings.passwordHash=passwordDigest(password,settings.salt);}
export function verifyPassword(settings:ServerSettings,password:string){return timingSafeEqual(Buffer.from(settings.passwordHash,'hex'),Buffer.from(passwordDigest(password,settings.salt),'hex'));}
export function saveSettings(directory:string,settings:ServerSettings){const path=join(directory,'server-secrets.json');writeFileSync(path+'.tmp',JSON.stringify(settings),{mode:0o600});renameSync(path+'.tmp',path);chmodSync(path,0o600);}
export function initialize(directory:string,url:string,password:string){
  if(existsSync(join(directory,'server-secrets.json')))throw new Error('이미 초기화된 서버입니다. 기존 키와 DB를 보존하세요.');
  const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'pem',type:'spki'}).toString();
  const config=checkConfig({url,publicKey}),settings:ServerSettings={...config,privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),salt:'',passwordHash:''};
  setPassword(settings,password);mkdirSync(directory,{recursive:true,mode:0o700});saveSettings(directory,settings);
  writeFileSync(join(directory,'license-public.json'),JSON.stringify(config,null,2),{mode:0o600});return config;
}
export function readSettings(directory:string):ServerSettings{return JSON.parse(readFileSync(join(directory,'server-secrets.json'),'utf8'));}
