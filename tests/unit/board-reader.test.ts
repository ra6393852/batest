import {beforeAll,afterAll,test,expect} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BoardReader} from '../../src/main/board-reader';
import {numericBeads,visibleOutcomes} from '../fixtures/numeric-beads';
let folder:string,file:string;
beforeAll(async()=>{folder=mkdtempSync(join(tmpdir(),'baccarat-worker-'));file=join(folder,'board-worker.cjs');await build({entryPoints:['src/main/board-worker.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',target:'node22'});});
afterAll(()=>rmSync(folder,{recursive:true,force:true}));
function screen(extra=false,x=30,y=240){
  const width=900,height=450,bitmap=new Uint8Array(width*height*4).fill(20);for(let p=3;p<bitmap.length;p+=4)bitmap[p]=255;
  const board=numericBeads(extra?[...visibleOutcomes,'B']:visibleOutcomes);
  for(let row=0;row<board.height;row++)bitmap.set(board.bitmap.subarray(row*board.width*4,(row+1)*board.width*4),((y+row)*width+x)*4);
  return {width,height,bitmap};
}
test('worker keeps the main event loop responsive and reuses only unchanged board pixels',async()=>{
  const reader=new BoardReader(file),image=screen();let ticks=0;const timer=setInterval(()=>ticks++,5);
  try{
    const first=await reader.read(image.width,image.height,image.bitmap);expect(first.cached).toBe(false);if(first.cached)throw new Error('first frame cached');
    expect(ticks).toBeGreaterThan(0);expect(first.analysis.outcomes).toEqual(visibleOutcomes);expect(image.bitmap.byteLength).toBe(image.width*image.height*4);
    image.bitmap[0]=99;const same=await reader.read(image.width,image.height,image.bitmap);expect(same.cached).toBe(true);expect(same.scannedPixels).toBe(0);
    const added=screen(true),next=await reader.read(added.width,added.height,added.bitmap);expect(next.cached).toBe(false);if(next.cached)throw new Error('changed frame cached');
    expect(next.located).toBe(true);expect(next.analysis.outcomes).toEqual([...visibleOutcomes,'B']);expect(next.scannedPixels).toBeLessThan(first.scannedPixels/2);
  }finally{clearInterval(timer);await reader.close();}
});
test('moving the board reacquires the full image, and reset/error cannot leave a stale cached result',async()=>{
  const reader=new BoardReader(file);
  try{
    const image=screen();const original=await reader.read(image.width,image.height,image.bitmap);expect(original.cached).toBe(false);
    const moved=screen(false,85,200),fresh=await reader.read(moved.width,moved.height,moved.bitmap);expect(fresh.cached).toBe(false);if(fresh.cached)throw new Error('moved frame cached');
    expect(fresh.located).toBe(false);expect(fresh.analysis.outcomes).toEqual(visibleOutcomes);expect(fresh.region.x).toBeGreaterThan(30);
    reader.reset();expect((await reader.read(moved.width,moved.height,moved.bitmap)).cached).toBe(false);
    await expect(reader.read(10,10,new Uint8Array(1))).rejects.toThrow('크기');
    expect((await reader.read(moved.width,moved.height,moved.bitmap)).cached).toBe(false);
  }finally{await reader.close();}
});
