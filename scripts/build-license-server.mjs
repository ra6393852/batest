import {build} from 'esbuild';
import {resolve} from 'node:path';
await build({entryPoints:{server:'src/license-server/cli.ts',library:'src/license-server/library.ts'},bundle:true,platform:'node',format:'cjs',target:'node24',outdir:'dist/license-server',outExtension:{'.js':'.cjs'},loader:{'.html':'text'},plugins:[{name:'raw-html',setup(b){b.onResolve({filter:/\.html\?raw$/},args=>({path:resolve(args.resolveDir,args.path.slice(0,-4))}));}}]});
