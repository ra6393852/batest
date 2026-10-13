import type { NativeImage } from 'electron';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { join } from 'node:path';
import { countFromLines, roomFromLines, type TextLine } from '../collector/window-text';
export class WindowReader {
  private worker?:Promise<Worker>;
  private counter?:Promise<Worker>;
  constructor(private resources:string|null,private workerPath:string){}
  private async lines(image:NativeImage):Promise<TextLine[]> {
    this.worker??=createWorker('eng+kor',1,{langPath:this.resources?join(this.resources,'langs'):join(__dirname,'../ocr-langs'),
      corePath:this.resources?join(this.resources,'node_modules/tesseract.js-core'):undefined,
      workerPath:this.workerPath,gzip:true,cacheMethod:'none'});
    const worker=await this.worker;
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
    const {data}=await worker.recognize(image.toPNG(),{},{blocks:true});
    return data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(l=>({text:l.text,confidence:l.confidence}))))??[];
  }
  async read(image:NativeImage){
    const {width,height}=image.getSize();
    const header=image.crop({x:0,y:0,width:Math.floor(width*.65),height:Math.max(1,Math.floor(height*.16))});
    const footer=image.crop({x:Math.floor(width*.65),y:Math.floor(height*.72),width:width-Math.floor(width*.65),height:height-Math.floor(height*.72)});
    const headerLines=await this.lines(header.resize({width:Math.floor(width*.65*2)}));
    const roomName=roomFromLines(headerLines);
    if(!roomName)return {roomName:null,total:null};
    this.counter??=createWorker('eng',1,{langPath:this.resources?join(this.resources,'langs'):join(__dirname,'../ocr-langs'),
      corePath:this.resources?join(this.resources,'node_modules/tesseract.js-core'):undefined,
      workerPath:this.workerPath,gzip:true,cacheMethod:'none'});
    const counter=await this.counter;
    await counter.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:'#0123456789PBT '});
    const {data}=await counter.recognize(footer.resize({width:Math.floor(width*.35*3)}).toPNG(),{},{blocks:true});
    const countLines=data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(l=>{
      const digits=l.words.flatMap(w=>w.symbols).filter(s=>/^[0-9]$/.test(s.text));
      return {text:l.text,confidence:digits.length?Math.min(...digits.map(s=>s.confidence)):0};
    })))??[];
    return {roomName,total:countFromLines(countLines)};
  }
  async close(){for(const worker of [this.worker,this.counter])try{if(worker)await(await worker).terminate();}catch{/* The capture panel displays initialization errors. */}}
}
