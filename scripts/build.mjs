import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await build({
  entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs',
  target: 'node22', outfile: 'dist/main/index.cjs', external: ['electron', 'sql.js', 'tesseract.js'],
});
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
await copyFile('tests/fixtures/table.html', 'dist/fixtures/table.html');
await cp('extension', 'dist/extension', { recursive: true });
await build({
  entryPoints: { background: 'src/extension/background.ts', content: 'src/extension/content.ts', popup: 'src/extension/popup.ts' },
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', outdir: 'dist/extension',
});
