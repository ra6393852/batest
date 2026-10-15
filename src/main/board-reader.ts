import {Worker} from 'node:worker_threads';
import type {BeadImageResult} from '../collector/bead-image';
import type {assessBeadColors} from '../collector/frame-color';
import type {PixelRect} from '../collector/crop-bitmap';
export interface BoardFrameData {key:string;region:PixelRect;width:number;height:number;bitmap:ArrayBuffer;analysis:BeadImageResult;colors:ReturnType<typeof assessBeadColors>;analysisMs:number;scannedPixels:number;located:boolean}
export type BoardRead=BoardFrameData&{cached:false}|{cached:true;key:string;analysisMs:number;scannedPixels:0};
// Native images remain in Electron's main process. The pure bitmap detector
// runs in Node's worker thread; transferred copies never detach caller buffers.
export class BoardReader {
  private worker?:Worker;
  private id=0;
  private pending=new Map<number,{resolve:(r:BoardRead)=>void;reject:(e:Error)=>void}>();
  constructor(private file:string){}
  private start(){
    if(this.worker)return this.worker;
    const worker=new Worker(this.file);this.worker=worker;
    worker.on('message',({id,result,error})=>{const task=this.pending.get(id);if(!task)return;this.pending.delete(id);if(error)task.reject(new Error(error));else task.resolve(result);});
    const fail=(error:Error)=>{if(this.worker===worker)this.worker=undefined;for(const task of this.pending.values())task.reject(error);this.pending.clear();};
    worker.on('error',fail);worker.on('exit',()=>{if(this.worker===worker)fail(new Error('그림판 판독 스레드가 종료되었습니다.'));});
    return worker;
  }
  read(width:number,height:number,bitmap:Uint8Array):Promise<BoardRead>{
    const worker=this.start(),id=++this.id,pixels=new Uint8Array(bitmap);
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});worker.postMessage({id,width,height,bitmap:pixels.buffer},[pixels.buffer]);});
  }
  reset(){this.worker?.postMessage({reset:true});}
  async close(){const worker=this.worker;this.worker=undefined;for(const task of this.pending.values())task.reject(new Error('판독 종료'));this.pending.clear();if(worker)await worker.terminate();}
}
