import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {addMonthsKorea,codeHash,deviceId,signLease,type LicenseRequest} from '../licensing/protocol';
export class LicenseError extends Error {constructor(public code:string,message:string,public status=403){super(message);}}
export class LicenseStore {
  readonly db:DatabaseSync;
  constructor(path:string,private signingKey:string,private clock=()=>Date.now()){
    this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS licenses(id TEXT PRIMARY KEY,batch TEXT NOT NULL,code_hash TEXT UNIQUE NOT NULL,code_hint TEXT NOT NULL,months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 12),customer TEXT NOT NULL DEFAULT '',blocked INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,activated INTEGER,expires INTEGER,device TEXT,session TEXT,session_until INTEGER NOT NULL DEFAULT 0,registration_after INTEGER NOT NULL DEFAULT 0,last_seen INTEGER);
      CREATE INDEX IF NOT EXISTS licenses_created ON licenses(created DESC,id);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,license_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL);`);
  }
  close(){this.db.close();}
  private atomic<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  private audit(id:string|null,action:string,detail:unknown={}){this.db.prepare('INSERT INTO audit(at,license_id,action,detail) VALUES(?,?,?,?)').run(this.clock(),id,action,JSON.stringify(detail));}
  issue(months:number,count:number,customer:string){
    addMonthsKorea(this.clock(),months);if(!Number.isInteger(count)||count<1||count>10000)throw new LicenseError('INPUT','발급 수량은 1~10,000개입니다.',400);
    return this.atomic(()=>{const batch=randomUUID(),rows=[];const insert=this.db.prepare('INSERT INTO licenses(id,batch,code_hash,code_hint,months,customer,created) VALUES(?,?,?,?,?,?,?)');
      for(let i=0;i<count;i++){const id=randomUUID(),code='BLA-'+randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g)!.join('-');insert.run(id,batch,codeHash(code),code.slice(-8),months,customer,this.clock());rows.push({id,code,months,customer});}
      this.audit(null,'issue',{batch,months,count});return {batch,rows};});
  }
  list(query='',offset=0){const search='%'+query+'%';return this.db.prepare(`SELECT id,batch,code_hint,months,customer,blocked,created,activated,expires,device,last_seen,CASE WHEN blocked=1 THEN 'blocked' WHEN activated IS NULL THEN 'unused' WHEN expires<=? THEN 'expired' ELSE 'active' END AS status FROM licenses WHERE customer LIKE ? OR id LIKE ? OR code_hint LIKE ? ORDER BY created DESC,id LIMIT 100 OFFSET ?`).all(this.clock(),search,search,search,offset);}
  history(id:string){return this.db.prepare('SELECT at,action,detail FROM audit WHERE license_id=? ORDER BY id DESC LIMIT 100').all(id);}
  manage(id:string,action:'extend'|'reset'|'block'|'unblock',months?:number){return this.atomic(()=>{
    const row=this.row(id),now=this.clock();
    if(action==='extend'){if(!row.activated)throw new LicenseError('UNUSED','아직 등록되지 않은 코드입니다. 등록 후 기간을 연장하세요.',400);const expires=addMonthsKorea(Math.max(now,row.expires as number),months!);this.db.prepare('UPDATE licenses SET expires=? WHERE id=?').run(expires,id);this.audit(id,'extend',{months,previous:row.expires,expires});}
    else if(action==='reset'){this.db.prepare('UPDATE licenses SET device=NULL,session=NULL,registration_after=MAX(registration_after,session_until),session_until=0 WHERE id=?').run(id);this.audit(id,'admin-reset');}
    else{this.db.prepare('UPDATE licenses SET blocked=?,session=NULL,registration_after=MAX(registration_after,session_until),session_until=0 WHERE id=?').run(action==='block'?1:0,id);this.audit(id,action);}
    return {ok:true};});}
  private row(id:string){const row=this.db.prepare('SELECT * FROM licenses WHERE id=?').get(id);if(!row)throw new LicenseError('UNKNOWN','등록된 이용권을 찾지 못했습니다.');return row;}
  apply(input:LicenseRequest){return this.atomic(()=>{
    const now=this.clock(),device=deviceId(input.publicKey);
    let id=input.licenseId;
    if(input.action==='activate'){if(!input.code)throw new LicenseError('CODE','이용 코드를 입력하세요.',400);id=this.db.prepare('SELECT id FROM licenses WHERE code_hash=?').get(codeHash(input.code))?.id as string|undefined;}
    if(!id)throw new LicenseError('CODE','이용 코드가 올바르지 않습니다.');const row=this.row(id);
    if(row.device&&row.device!==device)throw new LicenseError('DEVICE','다른 PC에 등록된 코드입니다. 판매자에게 등록 해제를 요청하세요.');
    if(input.action!=='activate'&&row.device!==device)throw new LicenseError('RESET','PC 등록이 해제되었습니다. 이용 코드를 다시 등록하세요.');
    // Releasing a session never clears PC registration or extends a term.
    if(input.action==='release'){if(row.session===input.sessionId)this.db.prepare('UPDATE licenses SET session=NULL,session_until=0 WHERE id=?').run(id);return {ok:true};}
    if(input.action==='deactivate'){this.db.prepare('UPDATE licenses SET device=NULL,session=NULL,registration_after=MAX(registration_after,session_until),session_until=0 WHERE id=?').run(id);this.audit(id,'customer-deactivate');return {ok:true};}
    if(row.blocked)throw new LicenseError('BLOCKED','판매자가 이용권을 차단했습니다.');
    if((row.registration_after as number)>now)throw new LicenseError('COOLDOWN','이전 실행의 인증 종료를 기다리고 있습니다. 최대 2분 후 다시 등록하세요.');
    let expires=row.expires as number|null;
    if(row.activated!==null&&expires!==null&&expires<=now)throw new LicenseError('EXPIRED','이용 기간이 만료되었습니다. 판매자에게 연장을 요청하세요.');
    if(row.session&&row.session!==input.sessionId&&(row.session_until as number)>now)throw new LicenseError('SESSION','이미 실행 중입니다. 기존 프로그램을 종료하거나 최대 2분 후 다시 시도하세요.');
    if(row.activated===null){expires=addMonthsKorea(now,row.months as number);this.db.prepare('UPDATE licenses SET activated=?,expires=? WHERE id=?').run(now,expires,id);this.audit(id,'first-activation',{months:row.months,expires});}
    if(!row.device)this.audit(id,'device-register');
    const validUntil=Math.min(now+120000,expires!);
    this.db.prepare('UPDATE licenses SET device=?,session=?,session_until=?,last_seen=? WHERE id=?').run(device,input.sessionId,validUntil,now,id);
    return signLease({licenseId:id,deviceId:device,sessionId:input.sessionId,issuedAt:now,validUntil,expiresAt:expires!},this.signingKey);
  });}
}
