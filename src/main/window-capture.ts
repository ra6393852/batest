import { app, desktopCapturer, nativeImage } from 'electron';
import type { CaptureInfo, CaptureWindow } from '../shared/types';
import type { AnalyzerStore } from './store';
import { VisibleBoardSession } from './visible-board-session';
import { ScoreReader } from './score-reader';
import { BoardReader, type BoardFrameData } from './board-reader';
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
  private frame?:BoardFrameData;
  private lastSource?:string;
  constructor(store:AnalyzerStore,private scores:ScoreReader,private reader:BoardReader,
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
    const previous=this.info,sameSource=this.lastSource===id;
    this.stop();this.sourceId=id;
    this.info={enabled:true,state:'waiting',windowName:source.name,message:'선택한 게임 창의 왼쪽 아래 그림판을 자동으로 가져오는 중',
      ...(sameSource?{preview:previous.preview,originalPreview:previous.originalPreview,capturedAt:previous.capturedAt,recognitionScale:previous.recognitionScale}: {})};
    this.notify(this.current());
    this.timer=setInterval(()=>{void this.tick();},1000);void this.tick();
  }
  stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.sourceId=undefined;this.generation++;this.session.pause();this.firstSeen.clear();this.backgroundScores.reset();this.scoreGroup='';this.reader.reset();this.frame=undefined;
    this.info={...this.info,enabled:false,state:'idle',message:'자동 가져오기 중지 · 기록은 보존됩니다.'};this.notify(this.current());}
  newShoe(){this.generation++;this.session.newBoard();this.firstSeen.clear();this.backgroundScores.reset();this.scoreGroup='';this.reader.reset();this.frame=undefined;
    this.info={...this.info,state:'waiting',message:'새 그림판 기록 · 현재 화면을 확인 중'};this.notify(this.current());}
  private async tick(){
    if(this.captureBusy||!this.sourceId)return;
    this.captureBusy=true;const generation=this.generation,started=performance.now();
    try{
      const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1920,height:1080},fetchWindowIcons:false});
      if(generation!==this.generation)return;
      const source=sources.find(s=>s.id===this.sourceId);
      if(!source||source.thumbnail.isEmpty()){
        this.session.pause();this.info={...this.info,detectedResults:undefined,state:'blocked',message:'게임 창이 닫혔거나 화면을 가져올 수 없습니다. 마지막 이미지를 유지합니다.'};this.notify(this.current());return;
      }
      const image=source.thumbnail,{width,height}=image.getSize();
      const original=image.crop({x:0,y:Math.floor(height*.55),width:Math.max(1,Math.floor(width*.42)),height:height-Math.floor(height*.55)});
      const native=original.getSize(),observedAt=new Date().toISOString();
      const read=await this.reader.read(native.width,native.height,original.toBitmap());
      if(generation!==this.generation)return;
      if(!read.cached){
        this.frame=read;
        const expanded=nativeImage.createFromBitmap(Buffer.from(read.bitmap),{width:read.width,height:read.height});
        const b=read.analysis.bounds,target=original.crop(read.region),size=target.getSize(),x=Math.floor(b.x/2),y=Math.floor(b.y/2);
        this.info={...this.info,preview:expanded.crop(b).toDataURL(),originalPreview:target.crop({x,y,width:Math.min(size.width-x,Math.ceil((b.x+b.width)/2)-x),height:Math.min(size.height-y,Math.ceil((b.y+b.height)/2)-y)}).toDataURL()};
      }
      const frame=this.frame;if(!frame||frame.key!==read.key)throw new Error('그림판 이미지 준비 중');
      this.lastSource=this.sourceId;
      const {analysis,colors}=frame;
      const key=JSON.stringify([this.info.roomName??'',analysis.outcomes]);
      if(!this.firstSeen.has(key))this.firstSeen.set(key,observedAt);
      const firstSeenAt=this.firstSeen.get(key)!;
      if(this.firstSeen.size>512)this.firstSeen.delete(this.firstSeen.keys().next().value!);
      const confidence=colors.length?Math.min(...colors.map(c=>c.confidence)):1,uncertain=colors.findIndex(c=>c.confidence<.92);
      const update=uncertain>=0?this.session.invalid(`색 판독 대기 · ${uncertain+1}번째 원(${analysis.outcomes[uncertain]})의 색상 일치 ${Math.round(colors[uncertain].confidence*100)}% · 본체 색을 확인 중입니다.`)
        :this.session.accept({outcomes:analysis.outcomes,confidence,observedAt,firstSeenAt});
      this.info={...this.info,...update,recognitionScale:2,detectedResults:analysis.outcomes.length,capturedAt:observedAt,processedAt:new Date().toISOString(),recognitionMs:Math.round(performance.now()-started),analysisMs:read.analysisMs,reusedFrame:read.cached,scannedPixels:read.scannedPixels};
      this.notify(this.current());if(update.changed)this.changed();
      if(update.state==='collecting'&&update.roomId&&update.shoeId&&analysis.beadCells){
        const group=JSON.stringify([update.roomId,update.shoeId]);if(group!==this.scoreGroup){this.backgroundScores.reset();this.scoreGroup=group;}
        this.backgroundScores.enqueue({key:JSON.stringify([group,frame.key]),roomId:update.roomId,shoeId:update.shoeId,width:frame.width,height:frame.height,
          bitmap:new Uint8Array(frame.bitmap),cells:analysis.beadCells,outcomes:analysis.outcomes});
      }
    }catch(error){if(generation===this.generation){
      const message=error instanceof Error?error.message:'화면 가져오기 실패';
      this.info={...this.info,...this.session.invalid(message),detectedResults:undefined,processedAt:new Date().toISOString()};this.notify(this.current());}}
    finally{this.captureBusy=false;}
  }
  async close(){this.stop();await this.reader.close();await this.scores.close();}
}
