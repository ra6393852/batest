import { app, desktopCapturer, nativeImage, type NativeImage } from 'electron';
import type { CaptureInfo, CaptureWindow } from '../shared/types';
import type { AnalyzerStore } from './store';
import { VisibleBoardSession } from './visible-board-session';
import { ScoreReader } from './score-reader';
import { analyzeBeadBitmap, type BeadImageResult } from '../collector/bead-image';
import { assessBeadColors } from '../collector/frame-color';
import { digitStrip } from '../collector/digit-bitmap';
import { createHash } from 'node:crypto';
import { doubleBitmap } from '../collector/double-bitmap';
import { BackgroundScores } from './background-scores';
export class WindowCapture {
  private info:CaptureInfo={enabled:false,state:'idle',message:'Chrome에서 게임을 연 뒤 게임 창을 선택하세요.'};
  private timer?:ReturnType<typeof setInterval>;
  private sourceId?:string;
  private generation=0;
  private captureBusy=false;
  private session:VisibleBoardSession;
  private backgroundScores:BackgroundScores;
  private scoreGroup='';
  private firstSeen=new Map<string,string>();
  constructor(store:AnalyzerStore,private scores:ScoreReader,
    private notify:(info:CaptureInfo)=>void,private changed:()=>void,private ownTitle='Baccarat Live Analyzer'){
    this.session=new VisibleBoardSession(store);
    this.backgroundScores=new BackgroundScores(store,(w,h,b,c)=>scores.read(w,h,b,c,false),changed);
  }
  current(){return {...this.info,appVersion:app.getVersion()};}
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
  stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.sourceId=undefined;this.generation++;this.session.pause();this.firstSeen.clear();this.backgroundScores.reset();this.scoreGroup='';
    this.info={...this.info,enabled:false,state:'idle',message:'자동 가져오기 중지 · 기록은 보존됩니다.'};this.notify(this.current());}
  newShoe(){this.generation++;this.session.newBoard();this.firstSeen.clear();this.backgroundScores.reset();this.scoreGroup='';
    this.info={...this.info,state:'waiting',message:'새 그림판 기록 · 현재 화면을 확인 중'};this.notify(this.current());}
  private async tick(){
    if(this.captureBusy||!this.sourceId)return;
    this.captureBusy=true;const generation=this.generation,started=performance.now();
    try{
      const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1920,height:1080},fetchWindowIcons:false});
      if(generation!==this.generation)return;
      const source=sources.find(s=>s.id===this.sourceId);
      if(!source||source.thumbnail.isEmpty()){
        this.session.pause();this.info={...this.info,detectedResults:undefined,state:'blocked',message:'게임 창이 닫혔거나 화면을 가져올 수 없습니다. 창을 다시 선택하세요.'};this.notify(this.current());return;
      }
      const image=source.thumbnail, {width,height}=image.getSize();
      const original=image.crop({x:0,y:Math.floor(height*.55),width:Math.max(1,Math.floor(width*.42)),height:height-Math.floor(height*.55)});
      const native=original.getSize();
      const expanded=doubleBitmap(native.width,native.height,original.toBitmap());
      const crop=nativeImage.createFromBitmap(Buffer.from(expanded.bitmap),{width:expanded.width,height:expanded.height});
      const observedAt=new Date().toISOString();
      let analysis:BeadImageResult|undefined;
      let firstSeenAt=observedAt;
      try{const size=crop.getSize();analysis=analyzeBeadBitmap(size.width,size.height,crop.toBitmap(),true,true);
        const key=JSON.stringify([this.info.roomName??'',analysis.outcomes]);if(!this.firstSeen.has(key))this.firstSeen.set(key,observedAt);
        firstSeenAt=this.firstSeen.get(key)!;
        if(this.firstSeen.size>512)this.firstSeen.delete(this.firstSeen.keys().next().value!);
      }catch{/* Preview remains available; OCR will show the recognition error. */}
      let preview=crop,originalPreview=original;
      if(analysis){preview=crop.crop(analysis.bounds);
        const x=Math.floor(analysis.bounds.x/2),y=Math.floor(analysis.bounds.y/2);
        originalPreview=original.crop({x,y,width:Math.min(native.width-x,Math.ceil((analysis.bounds.x+analysis.bounds.width)/2)-x),height:Math.min(native.height-y,Math.ceil((analysis.bounds.y+analysis.bounds.height)/2)-y)});
      }
      this.info={...this.info,preview:preview.toDataURL(),originalPreview:originalPreview.toDataURL(),recognitionScale:2,detectedResults:analysis?.outcomes.length,capturedAt:observedAt};this.notify(this.current());
      // The B/P/T path has no OCR await. Optional digits run in their own queue.
      this.recognize(crop,observedAt,generation,analysis,firstSeenAt,started);
    }catch{if(generation===this.generation){this.session.pause();this.info={...this.info,detectedResults:undefined,state:'blocked',message:'화면 가져오기 실패 · 게임 창이 최소화되었는지 확인하세요.'};this.notify(this.current());}}
    finally{this.captureBusy=false;}
  }
  private recognize(crop:NativeImage,observedAt:string,generation:number,scanned?:BeadImageResult,firstSeenAt=observedAt,started=performance.now()){
    try{
      const {width,height}=crop.getSize(),bitmap=crop.toBitmap();
      const analysis=scanned??analyzeBeadBitmap(width,height,bitmap,true,true);
      if(analysis.outcomes.length===0){const update=this.session.accept({outcomes:[],confidence:1,observedAt});
        this.firstSeen.clear();this.info={...this.info,...update,processedAt:new Date().toISOString()};this.notify(this.current());return;}
      if(!analysis.beadCells)throw new Error('비드로드 칸을 읽지 못했습니다.');
      const colors=assessBeadColors(width,bitmap,analysis.beadCells,analysis.outcomes);
      const confidence=Math.min(...colors.map(c=>c.confidence)),uncertain=colors.findIndex(c=>c.confidence<.92);
      if(generation!==this.generation)return;
      const update=uncertain>=0?this.session.invalid(`색 판독 대기 · ${uncertain+1}번째 원(${analysis.outcomes[uncertain]})의 색상 일치 ${Math.round(colors[uncertain].confidence*100)}% · 쌍 표시를 제외해도 본체 색이 불확실합니다.`)
        :this.session.accept({outcomes:analysis.outcomes,confidence,observedAt,firstSeenAt});
      this.info={...this.info,...update,processedAt:new Date().toISOString(),recognitionMs:Math.round(performance.now()-started)};this.notify(this.current());if(update.changed)this.changed();
      if(update.state==='collecting'&&update.roomId&&update.shoeId){
        const group=JSON.stringify([update.roomId,update.shoeId]);if(group!==this.scoreGroup){this.backgroundScores.reset();this.scoreGroup=group;}
        const glyphs=digitStrip(width,height,bitmap,analysis.beadCells);
        this.backgroundScores.enqueue({key:JSON.stringify([group,analysis.outcomes,createHash('sha256').update(glyphs.bitmap).digest('hex')]),roomId:update.roomId,shoeId:update.shoeId,
          width,height,bitmap,cells:analysis.beadCells,outcomes:analysis.outcomes});
      }
    }catch(error){if(generation===this.generation){const message=error instanceof Error?error.message:'그림판 확인 실패';
      const update=this.session.invalid(message);
      this.info={...this.info,...update,processedAt:new Date().toISOString()};this.notify(this.current());}}
  }
  async close(){this.stop();await this.scores.close();}
}
