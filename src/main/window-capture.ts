import { desktopCapturer, type NativeImage } from 'electron';
import type { CaptureInfo, CaptureWindow } from '../shared/types';
import type { AnalyzerStore } from './store';
import { LiveSession } from './live-session';
import { WindowReader } from './window-reader';
import { ScoreReader } from './score-reader';
import { analyzeBeadBitmap, type BeadImageResult } from '../collector/bead-image';
import { beadColorConfidence } from '../collector/frame-color';
import { digitStrip } from '../collector/digit-bitmap';
import { createHash } from 'node:crypto';
export class WindowCapture {
  private info:CaptureInfo={enabled:false,state:'idle',message:'Chrome에서 게임을 연 뒤 게임 창을 선택하세요.'};
  private timer?:ReturnType<typeof setInterval>;
  private sourceId?:string;
  private generation=0;
  private captureBusy=false;
  private recognitionBusy=false;
  private session:LiveSession;
  private lastScoreKey='';
  private scoreCache:Array<number|null>=[];
  private firstSeen=new Map<string,string>();
  constructor(store:AnalyzerStore,private text:WindowReader,private scores:ScoreReader,
    private notify:(info:CaptureInfo)=>void,private changed:()=>void,private ownTitle='Baccarat Live Analyzer'){
    this.session=new LiveSession(store);
  }
  current(){return {...this.info};}
  async windows():Promise<CaptureWindow[]>{
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
    return sources.filter(s=>s.name!==this.ownTitle).map(s=>({id:s.id,name:s.name}));
  }
  async start(id:string){
    const source=(await this.windows()).find(s=>s.id===id);
    if(!source)throw new Error('선택한 창이 닫혔습니다. 게임 창 목록을 다시 불러오세요.');
    this.stop();this.sourceId=id;
    this.info={enabled:true,state:'waiting',windowName:source.name,message:'선택한 게임 창의 왼쪽 아래 그림판을 자동으로 가져오는 중'};
    this.notify(this.current());
    this.timer=setInterval(()=>{void this.tick();},1000);void this.tick();
  }
  stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.sourceId=undefined;this.generation++;this.session.pause();this.firstSeen.clear();
    this.info={...this.info,enabled:false,state:'idle',message:'자동 가져오기 중지 · 기록은 보존됩니다.'};this.notify(this.current());}
  newShoe(){if(!this.info.roomName)throw new Error('방 이름 인식 후 새 슈를 구분할 수 있습니다.');this.session.newShoe(this.info.roomName);this.firstSeen.clear();
    this.info={...this.info,state:'waiting',message:'새 슈로 구분했습니다. 다음 그림판 확인 대기'};this.notify(this.current());}
  private async tick(){
    if(this.captureBusy||!this.sourceId)return;
    this.captureBusy=true;const generation=this.generation;
    try{
      const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1920,height:1080},fetchWindowIcons:false});
      if(generation!==this.generation)return;
      const source=sources.find(s=>s.id===this.sourceId);
      if(!source||source.thumbnail.isEmpty()){
        this.session.pause();this.info={...this.info,state:'blocked',message:'게임 창이 닫혔거나 화면을 가져올 수 없습니다. 창을 다시 선택하세요.'};this.notify(this.current());return;
      }
      const image=source.thumbnail, {width,height}=image.getSize();
      const crop=image.crop({x:0,y:Math.floor(height*.55),width:Math.max(1,Math.floor(width*.42)),height:height-Math.floor(height*.55)});
      const observedAt=new Date().toISOString();
      let analysis:BeadImageResult|undefined;
      let firstSeenAt=observedAt;
      try{const size=crop.getSize();analysis=analyzeBeadBitmap(size.width,size.height,crop.toBitmap(),true,true);
        const key=JSON.stringify([this.info.roomName??'',analysis.outcomes]);if(!this.firstSeen.has(key))this.firstSeen.set(key,observedAt);
        firstSeenAt=this.firstSeen.get(key)!;
        if(this.firstSeen.size>512)this.firstSeen.delete(this.firstSeen.keys().next().value!);
      }catch{/* Preview remains available; OCR will show the recognition error. */}
      this.info={...this.info,preview:crop.toDataURL(),capturedAt:observedAt};this.notify(this.current());
      // Capturing and preview continue once a second even while OCR is running.
      if(!this.recognitionBusy){this.recognitionBusy=true;void this.recognize(image,crop,observedAt,generation,analysis,firstSeenAt).finally(()=>{this.recognitionBusy=false;});}
    }catch{if(generation===this.generation){this.session.pause();this.info={...this.info,state:'blocked',message:'화면 가져오기 실패 · 게임 창이 최소화되었는지 확인하세요.'};this.notify(this.current());}}
    finally{this.captureBusy=false;}
  }
  private async recognize(image:NativeImage,crop:NativeImage,observedAt:string,generation:number,scanned?:BeadImageResult,firstSeenAt=observedAt){
    let roomName:string|null=null;
    try{
      const identity=await this.text.read(image);
      if(generation!==this.generation)return;
      roomName=identity.roomName;
      if(!identity.roomName)throw new Error('방 이름을 읽지 못했습니다. 게임 창 왼쪽 위의 방 이름이 보여야 합니다.');
      if(identity.total==null)throw new Error('전체 결과 수(# 숫자)를 읽지 못했습니다. 그림판 위의 결과 수가 보여야 합니다.');
      const {width,height}=crop.getSize(),bitmap=crop.toBitmap();
      const analysis=scanned??analyzeBeadBitmap(width,height,bitmap,true,identity.total===0);
      if(identity.total===0&&analysis.outcomes.length===0){const update=this.session.accept({roomName:identity.roomName,total:0,outcomes:[],complete:true,confidence:1,observedAt});
        this.firstSeen.clear();this.info={...this.info,...update,processedAt:new Date().toISOString()};this.notify(this.current());return;}
      if(!analysis.beadCells)throw new Error('비드로드 칸을 읽지 못했습니다.');
      const confidence=Math.min(...beadColorConfidence(width,bitmap,analysis.beadCells,analysis.outcomes));
      const glyphs=digitStrip(width,height,bitmap,analysis.beadCells);
      const key=JSON.stringify([identity.roomName,analysis.outcomes,createHash('sha256').update(glyphs.bitmap).digest('hex')]);
      if(key!==this.lastScoreKey){
        this.lastScoreKey=key;this.scoreCache=[];
        try{const read=await this.scores.read(width,height,bitmap,analysis.beadCells);this.scoreCache=read.scores.map((v,i)=>read.confidences[i]>=.92?v:null);}catch{/* Scores are optional; uncertain digits never affect stored results. */}
      }
      if(generation!==this.generation)return;
      const update=this.session.accept({roomName:identity.roomName,total:identity.total,outcomes:analysis.outcomes,
        complete:analysis.completeGrid===true,confidence,observedAt,firstSeenAt,scores:this.scoreCache});
      this.info={...this.info,...update,processedAt:new Date().toISOString()};this.notify(this.current());if(update.changed)this.changed();
    }catch(error){if(generation===this.generation){const message=error instanceof Error?error.message:'그림판 확인 실패';
      const update=roomName?this.session.hold(roomName,message):this.session.invalid(message);
      this.info={...this.info,...update,...(!roomName?{roomId:undefined,roomName:undefined,shoeId:undefined}:{}),processedAt:new Date().toISOString()};this.notify(this.current());}}
  }
  async close(){this.stop();await this.text.close();await this.scores.close();}
}
