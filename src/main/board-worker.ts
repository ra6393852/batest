import {parentPort} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {analyzeBeadBitmap,type BeadImageResult} from '../collector/bead-image';
import {assessBeadColors} from '../collector/frame-color';
import {doubleBitmap} from '../collector/double-bitmap';
import {cropBitmap,type PixelRect} from '../collector/crop-bitmap';
import type {BoardFrameData,BoardRead} from './board-reader';
let cache:{sourceWidth:number;sourceHeight:number;region:PixelRect;key:string}|undefined;
const hash=(pixels:Uint8Array)=>createHash('sha256').update(pixels).digest('hex');
function scan(width:number,height:number,bitmap:Uint8Array):BoardRead{
  const started=performance.now();let region:PixelRect={x:0,y:0,width,height},pixels=bitmap,located=false;
  let analysis:BeadImageResult|undefined,expanded:ReturnType<typeof doubleBitmap>|undefined,scannedPixels=0;
  if(cache?.sourceWidth===width&&cache.sourceHeight===height){
    region=cache.region;pixels=cropBitmap(width,height,bitmap,region);
    const key=hash(pixels);if(key===cache.key)return {cached:true,key,analysisMs:Math.round(performance.now()-started),scannedPixels:0};
    try{expanded=doubleBitmap(region.width,region.height,pixels);scannedPixels+=expanded.width*expanded.height;
      analysis=analyzeBeadBitmap(expanded.width,expanded.height,expanded.bitmap,true,true);
      const b=analysis.bounds;if(b.x<2||b.y<2||b.x+b.width>expanded.width-2||b.y+b.height>expanded.height-2)analysis=undefined;
    }catch{analysis=undefined;}
    located=!!analysis;
  }
  if(!analysis){
    expanded=doubleBitmap(width,height,bitmap);scannedPixels+=expanded.width*expanded.height;
    analysis=analyzeBeadBitmap(expanded.width,expanded.height,expanded.bitmap,true,true);
    const b=analysis.bounds,x=Math.max(0,Math.floor(b.x/2)-4),y=Math.max(0,Math.floor(b.y/2)-4);
    const right=Math.min(width,Math.ceil((b.x+b.width)/2)+4),bottom=Math.min(height,Math.ceil((b.y+b.height)/2)+4);
    region={x,y,width:right-x,height:bottom-y};pixels=cropBitmap(width,height,bitmap,region);
    expanded=doubleBitmap(region.width,region.height,pixels);
    analysis={...analysis,bounds:{...b,x:b.x-x*2,y:b.y-y*2},beadCells:analysis.beadCells?.map(c=>({...c,x:c.x-x*2,y:c.y-y*2}))};
  }
  const image=expanded!,key=hash(pixels);cache={sourceWidth:width,sourceHeight:height,region,key};
  return {cached:false,key,region,width:image.width,height:image.height,bitmap:image.bitmap.buffer as ArrayBuffer,analysis,
    colors:analysis.beadCells?assessBeadColors(image.width,image.bitmap,analysis.beadCells,analysis.outcomes):[],analysisMs:Math.round(performance.now()-started),scannedPixels,located};
}
parentPort!.on('message',({id,width,height,bitmap,reset})=>{
  if(reset){cache=undefined;return;}
  try{const result=scan(width,height,new Uint8Array(bitmap));parentPort!.postMessage({id,result},result.cached?[]:[result.bitmap]);}
  catch(error){cache=undefined;parentPort!.postMessage({id,error:error instanceof Error?error.message:'그림판 확인 실패'});}
});
