import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
const config=process.argv[2];
if(!config||!existsSync(config))throw Error('사용법: npm run dist:customer -- license-data/license-public.json');
const data=JSON.parse(readFileSync(config,'utf8'));if(new URL(data.url).protocol!=='https:')throw Error('실제 판매용 고객 빌드는 공개 HTTPS 서버 주소가 필요합니다.');
// Packaging invokes build.mjs with the pinned server config. No secret keys enter the app.
const env={...process.env,LICENSE_CONFIG_FILE:config,REQUIRE_LICENSE_BUILD:'1'};
for(const args of [['scripts/build.mjs'],['node_modules/electron-builder/cli.js','--win','zip','--x64','--config.win.artifactName=Baccarat-Live-Analyzer-${version}-${arch}-Customer.${ext}']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env});if(result.status!==0)process.exit(result.status??1);
}
