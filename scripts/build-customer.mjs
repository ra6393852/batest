import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,appendFileSync} from 'node:fs';
const config=process.argv[2];
if(!config||!existsSync(config))throw Error('사용법: npm run dist:customer -- license-data/license-public.json');
const data=JSON.parse(readFileSync(config,'utf8'));if(new URL(data.url).protocol!=='https:')throw Error('실제 판매용 고객 빌드는 공개 HTTPS 서버 주소가 필요합니다.');
const temporary=new URL(data.url).hostname.endsWith('.trycloudflare.com');
// Packaging invokes build.mjs with the pinned server config. No secret keys enter the app.
const env={...process.env,LICENSE_CONFIG_FILE:config,REQUIRE_LICENSE_BUILD:'1'};
const artifact=temporary?'Baccarat-Live-Analyzer-${version}-${arch}-Customer-Trial.${ext}':'Baccarat-Live-Analyzer-${version}-${arch}-Customer.${ext}';
for(const args of [['scripts/build.mjs'],['node_modules/electron-builder/cli.js','--win','zip','--x64','--config.win.artifactName='+artifact]]){
  if(temporary&&args[0]!=='scripts/build.mjs')appendFileSync('dist/portable-readme.txt','\n외부 연결 시험용: 임시 Cloudflare 주소에 연결합니다. 터널을 다시 실행하면 주소가 바뀔 수 있으며 그 경우 새 Customer 빌드가 필요합니다. 판매 배포에는 유지 가능한 고정 주소를 사용하세요.\n');
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env});if(result.status!==0)process.exit(result.status??1);
}
