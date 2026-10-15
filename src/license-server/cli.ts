import {resolve,join} from 'node:path';
import {chmodSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {initialize,readSettings} from './settings';
import {LicenseStore} from './store';
import {createLicenseServer} from './server';
async function main(){
  const args=process.argv.slice(2),command=args[0],option=(name:string,fallback='')=>args[args.indexOf(name)+1]??fallback;
  const directory=resolve(args.includes('--data')?option('--data'):'license-data');
  if(command==='init'){
    if(!args.includes('--url'))throw new Error('init --url https://인증서버주소 --data license-data 형식으로 실행하세요.');
    process.stdout.write('새 판매자 관리자 암호(12~128자, 입력 숨김): ');
    const muted=new Writable({write(_chunk,_encoding,done){done();}}),rl=createInterface({input:process.stdin,output:muted,terminal:!!process.stdin.isTTY});
    try{const password=await rl.question('');initialize(directory,option('--url'),password);process.stdout.write('\n초기화 완료. license-public.json은 고객용 빌드에 사용하세요. server-secrets.json과 DB는 판매자만 보관하세요.\n');}finally{rl.close();}return;
  }
  if(command!=='start')throw new Error('명령: init --url https://서버주소 또는 start [--data license-data] [--port 4380]');
  const settings=readSettings(directory),store=new LicenseStore(join(directory,'licenses.sqlite'),settings.privateKey);chmodSync(join(directory,'licenses.sqlite'),0o600);
  const server=createLicenseServer(store,settings,directory),port=Number(args.includes('--port')?option('--port'):'4380');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('올바른 포트 번호를 지정하세요.');
  server.listen(port,'127.0.0.1',()=>console.log(`인증 서버 실행 · 포트 ${port} · 관리자 경로 /admin · 외부 공개는 HTTPS 프록시를 사용하세요.`));
  for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{server.close(()=>{store.close();process.exit(0);});});
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'서버 실행 실패');process.exitCode=1;});
