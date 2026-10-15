import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {LicenseStore,LicenseError} from './store';
import {type ServerSettings,verifyPassword,setPassword,saveSettings} from './settings';
import {requestSchema,verifyRequest,actions} from '../licensing/protocol';
import adminHTML from './admin.html?raw';
export function createLicenseServer(store:LicenseStore,settings:ServerSettings,directory?:string,clock=()=>Date.now()){
  const challenges=new Map<string,{key:string;action:string;until:number}>(),sessions=new Map<string,number>(),limits=new Map<string,{count:number;until:number}>();
  const gc=setInterval(()=>{const now=clock();for(const [k,v] of challenges)if(v.until<=now)challenges.delete(k);for(const [k,v] of sessions)if(v<=now)sessions.delete(k);for(const [k,v] of limits)if(v.until<=now)limits.delete(k);},30000);gc.unref();
  const limited=(key:string,max:number)=>{const now=clock(),old=limits.get(key),entry=old&&old.until>now?old:{count:0,until:now+60000};if(limits.size>20000&&!old)throw new LicenseError('BUSY','잠시 후 다시 시도하세요.',429);entry.count++;limits.set(key,entry);if(entry.count>max)throw new LicenseError('RATE','요청이 많습니다. 1분 후 다시 시도하세요.',429);};
  function send(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  async function body(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw new LicenseError('INPUT','JSON 요청이 필요합니다.',415);const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw new LicenseError('INPUT','요청이 너무 큽니다.',413);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());}
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    try{
      const url=new URL(req.url??'/',settings.url),path=url.pathname;
      if(req.method==='GET'&&path==='/health'){send(res,200,{ok:true});return;}
      if(req.method==='GET'&&(path==='/'||path==='/admin')){res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(adminHTML);return;}
      if(req.method==='GET'&&path==='/admin.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(adminHTML.split('<!--SCRIPT-->')[1].split('<!--ENDSCRIPT-->')[0]);return;}
      if(path.startsWith('/admin/')){
        // Strict same-origin JSON mutations plus HttpOnly/SameSite cookies prevent CSRF.
        if(req.method==='POST'&&req.headers.origin!==new URL(settings.url).origin)throw new LicenseError('ORIGIN','관리자 페이지에서 요청하세요.');
        const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('bla_admin='))?.slice(10),valid=cookie&&((sessions.get(cookie)??0)>clock());
        if(path==='/admin/login'&&req.method==='POST'){
          limited('login:'+req.socket.remoteAddress,10);const input=z.object({password:z.string().min(1).max(128)}).strict().parse(await body(req));
          if(!verifyPassword(settings,input.password))throw new LicenseError('LOGIN','관리자 암호가 일치하지 않습니다.',401);
          if(sessions.size>=1000)throw new LicenseError('BUSY','관리자 세션이 많습니다.',429);const token=randomBytes(32).toString('hex');sessions.set(token,clock()+3600000);
          res.setHeader('Set-Cookie',`bla_admin=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=3600${settings.url.startsWith('https:')?'; Secure':''}`);send(res,200,{ok:true});return;
        }
        if(!valid)throw new LicenseError('LOGIN','관리자 로그인이 필요합니다.',401);
        if(path==='/admin/logout'&&req.method==='POST'){sessions.delete(cookie!);res.setHeader('Set-Cookie','bla_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0');send(res,200,{ok:true});return;}
        if(path==='/admin/licenses'&&req.method==='GET'){send(res,200,{rows:store.list(z.string().max(120).parse(url.searchParams.get('q')??''),z.coerce.number().int().min(0).max(10000000).parse(url.searchParams.get('offset')??0))});return;}
        if(path==='/admin/issue'&&req.method==='POST'){const i=z.object({months:z.number().int().min(1).max(12),count:z.number().int().min(1).max(10000),customer:z.string().max(120)}).strict().parse(await body(req));send(res,200,store.issue(i.months,i.count,i.customer));return;}
        if(path==='/admin/manage'&&req.method==='POST'){const i=z.object({id:z.uuid(),action:z.enum(['extend','reset','block','unblock']),months:z.number().int().min(1).max(12).optional()}).strict().parse(await body(req));if(i.action==='extend'&&!i.months)throw new LicenseError('INPUT','연장 개월 수를 선택하세요.',400);send(res,200,store.manage(i.id,i.action,i.months));return;}
        if(path==='/admin/history'&&req.method==='GET'){send(res,200,{rows:store.history(z.uuid().parse(url.searchParams.get('id')))});return;}
        if(path==='/admin/password'&&req.method==='POST'){const i=z.object({current:z.string().max(128),password:z.string().min(12).max(128)}).strict().parse(await body(req));if(!verifyPassword(settings,i.current))throw new LicenseError('LOGIN','현재 암호가 일치하지 않습니다.',401);setPassword(settings,i.password);if(directory)saveSettings(directory,settings);sessions.clear();send(res,200,{ok:true});return;}
      }
      if(req.method==='POST'&&path==='/v1/challenge'){
        limited('challenge:'+req.socket.remoteAddress,3000);const i=z.object({publicKey:z.string().min(40).max(200),action:z.enum(actions)}).strict().parse(await body(req));
        if(challenges.size>=10000)throw new LicenseError('BUSY','잠시 후 다시 시도하세요.',429);const nonce=randomBytes(24).toString('hex');challenges.set(nonce,{key:i.publicKey,action:i.action,until:clock()+30000});send(res,200,{nonce});return;
      }
      if(req.method==='POST'&&/^\/v1\/(activate|renew|deactivate|release)$/.test(path)){
        limited('proof:'+req.socket.remoteAddress,3000);const i=z.object({request:requestSchema,signature:z.string().max(200)}).strict().parse(await body(req)),r=i.request,challenge=challenges.get(r.nonce);challenges.delete(r.nonce);
        if(!challenge||challenge.until<=clock()||challenge.key!==r.publicKey||challenge.action!==r.action||path!==`/v1/${r.action}`||!verifyRequest(r,i.signature))throw new LicenseError('PROOF','기기 인증을 확인하지 못했습니다.');
        send(res,200,store.apply(r));return;
      }
      send(res,404,{error:'NOT_FOUND',message:'요청을 찾지 못했습니다.'});
    }catch(error){if(error instanceof LicenseError)send(res,error.status,{error:error.code,message:error.message});else if(error instanceof z.ZodError||error instanceof SyntaxError)send(res,400,{error:'INPUT',message:'입력 형식을 확인하세요.'});else send(res,500,{error:'SERVER',message:'서버 처리 실패. 판매자에게 문의하세요.'});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.on('close',()=>clearInterval(gc));return server;
}
