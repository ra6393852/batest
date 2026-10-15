import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile, cp,readFile,writeFile } from 'node:fs/promises';
// Trust is fixed at build time. Runtime flags/env/files cannot redirect a sold app.
import {createPublicKey} from 'node:crypto';
let licenseConfig=null;
if(process.env.LICENSE_CONFIG_FILE){
  licenseConfig=JSON.parse(await readFile(process.env.LICENSE_CONFIG_FILE,'utf8'));const url=new URL(licenseConfig.url);
  if(Object.keys(licenseConfig).sort().join(',')!=='publicKey,url'||url.username||url.password||url.hash||url.search||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))||createPublicKey(licenseConfig.publicKey).asymmetricKeyType!=='ed25519')throw Error('Invalid public license config');
  licenseConfig.url=url.origin;
}
if(process.env.REQUIRE_LICENSE_BUILD==='1'&&!licenseConfig)throw Error('판매용 빌드에는 LICENSE_CONFIG_FILE이 필요합니다.');
await build({
  entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs',
  target: 'node22', outfile: 'dist/main/index.cjs', external: ['electron', 'sql.js', 'tesseract.js'],
  define:{__LICENSE_CONFIG__:JSON.stringify(licenseConfig)},
});
await build({entryPoints:['src/main/board-worker.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist/main/board-worker.cjs'});
await build({
  entryPoints: { dashboard: 'src/preload/dashboard.ts', collector: 'src/preload/collector.ts' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', outdir: 'dist/preload',
  outExtension: { '.js': '.cjs' }, external: ['electron'],
});
await build({
  entryPoints: ['node_modules/tesseract.js/src/worker-script/node/index.js'], bundle: true,
  platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/main/ocr-worker.cjs', external: ['tesseract.js-core', 'tesseract.js-core/*'],
});
await viteBuild();
await mkdir('dist/fixtures', { recursive: true });
await mkdir('dist/ocr-langs', { recursive: true });
for (const lang of ['eng','kor']) await copyFile(`node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`, `dist/ocr-langs/${lang}.traineddata.gz`);
await copyFile('tests/fixtures/table.html', 'dist/fixtures/table.html');
await cp('extension', 'dist/extension', { recursive: true });
await build({
  entryPoints: { background: 'src/extension/background.ts', content: 'src/extension/content.ts', popup: 'src/extension/popup.ts' },
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', outdir: 'dist/extension',
});
await writeFile('dist/portable-readme.txt',(licenseConfig?'배포 유형: 판매용 Customer — 이용 코드로 인증합니다.\n':'배포 유형: 관리자 검토용 Review — 판매용 코드 보호가 없습니다. 고객에게 판매하지 마세요.\n')+await readFile('packaging/portable-readme.txt','utf8'));
await import('./build-license-server.mjs');
