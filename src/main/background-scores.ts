import type {Outcome,Observation} from '../shared/types';
import type {DigitCell} from '../collector/digit-bitmap';
import type {AnalyzerStore} from './store';
export interface ScoreFrame {key:string;roomId:string;shoeId:string;outcomes:Outcome[];width:number;height:number;bitmap:Uint8Array;cells:DigitCell[]}
type ReadScores=(width:number,height:number,bitmap:Uint8Array,cells:DigitCell[])=>Promise<{scores:Array<number|null>;confidences:number[]}>;
// One running job and the latest queued frame only. B/P/T confirmation never
// awaits this queue. Delayed scores enrich existing rows without new predictions
// or regrading, and reset discards work belonging to a stopped capture/group.
export class BackgroundScores {
  private queued?:ScoreFrame;
  private busy=false;
  private generation=0;
  private attempted=new Set<string>();
  constructor(private store:AnalyzerStore,private read:ReadScores,private changed:()=>void){}
  reset(){this.generation++;this.queued=undefined;this.attempted.clear();}
  enqueue(frame:ScoreFrame){
    if(this.attempted.has(frame.key))return;
    this.attempted.add(frame.key);if(this.attempted.size>128)this.attempted.delete(this.attempted.values().next().value!);
    this.queued=frame;if(!this.busy)void this.drain();
  }
  private async drain(){
    this.busy=true;
    try{while(this.queued){
      const frame=this.queued,generation=this.generation;this.queued=undefined;
      try{
        const snapshot=this.store.snapshot(frame.roomId,frame.shoeId);
        if(snapshot.roomId!==frame.roomId||snapshot.shoeId!==frame.shoeId)continue;
        const rows=new Map(snapshot.results.map(r=>[r.round,r]));
        const indices=frame.cells.map((_,i)=>i).filter(i=>{const r=rows.get(i+1);return r&&r.outcome===frame.outcomes[i]&&r.score===undefined;});
        if(!indices.length)continue;
        const read=await this.read(frame.width,frame.height,frame.bitmap,indices.map(i=>frame.cells[i]));
        if(generation!==this.generation)continue;
        const points:Observation[]=[];
        indices.forEach((index,i)=>{const score=read.scores[i],row=rows.get(index+1)!;
          if(score!=null&&Number.isInteger(score)&&score>=0&&score<=9&&read.confidences[i]>=.92)points.push({roomId:row.roomId,roomName:row.roomName,shoeId:row.shoeId,round:row.round,outcome:row.outcome,
            historical:row.historical,score,source:'ocr',confidence:1});
        });
        if(points.length){this.store.ingest(points);this.changed();}
      }catch{/* Scores are optional. Unreadable digits remain blank. */}
    }}finally{this.busy=false;}
  }
}
