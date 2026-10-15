import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8')),url=new URL(config.url);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('공개 HTTPS 인증 서버 주소가 필요합니다.');
const response=await fetch(new URL('/health',url),{redirect:'error',signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error('외부 인증 서버 연결 실패: HTTP '+response.status);
const body=await response.json();if(body.ok!==true)throw Error('인증 서버 health 응답을 확인하지 못했습니다.');
console.log('외부 HTTPS 인증 서버 health 확인 완료');
