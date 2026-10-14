import { createHash, randomUUID } from 'node:crypto';
import type { Outcome } from '../shared/types';
import type { AnalyzerStore } from './store';
export interface LiveFrame {
  roomName: string; outcomes: Outcome[]; confidence: number; total: number;
  complete: boolean; observedAt: string; firstSeenAt?:string; scores?: Array<number|null>;
}
export interface LiveUpdate {
  state:'waiting'|'collecting'|'blocked'; message:string; roomId?:string; roomName?:string; shoeId?:string; rounds?:number; changed?:boolean;
}
interface Candidate { key:string; repeats:number; observedAt:string; scores?:Array<number|null> }
export class LiveSession {
  private candidate?:Candidate;
  private active?:{roomId:string;shoeId:string;lastSeen:string};
  private resetRooms=new Set<string>();
  constructor(private store:AnalyzerStore){}
  pause(){this.candidate=undefined;this.active=undefined;}
  invalid(message:string):LiveUpdate {this.pause();return {state:'blocked',message};}
  hold(roomName:string,message:string):LiveUpdate {
    const roomId=`screen:${createHash('sha256').update(roomName).digest('hex').slice(0,24)}`;
    this.candidate=undefined;
    // A readable, unchanged room with a transient counter/grid mismatch is not
    // evidence that the user left it. Keep the last verified time; prolonged
    // gaps, unknown rooms, explicit stop and room changes still exclude grading.
    if(this.active?.roomId!==roomId)this.active=undefined;
    return {state:'blocked',roomId,roomName,message};
  }
  accept(frame:LiveFrame):LiveUpdate {
    const roomId=`screen:${createHash('sha256').update(frame.roomName).digest('hex').slice(0,24)}`;
    const base={roomId,roomName:frame.roomName,rounds:frame.outcomes.length};
    const key=JSON.stringify([roomId,frame.total,frame.outcomes]);
    if(this.candidate?.key===key)this.candidate.repeats++;
    else this.candidate={key,repeats:1,observedAt:frame.firstSeenAt??frame.observedAt,scores:frame.scores};
    if(frame.total!==frame.outcomes.length||(!frame.complete&&frame.total>0))
      return this.hold(frame.roomName,'전체 결과 수와 그림판 개수가 다르거나 시작 열이 잘렸습니다. 누락 기록을 자동으로 만들지 않습니다.');
    if(frame.confidence<0.92)return {...base,state:'waiting',message:'색상 판독이 불확실합니다. 결과 확정을 보류하고 다음 화면을 확인합니다.'};
    if(this.candidate.repeats<2)return {...base,state:'waiting',message:`${frame.roomName} · 같은 결과를 한 번 더 확인 중`};
    const firstSeen=this.candidate.observedAt;
    if(!frame.outcomes.length){this.resetRooms.add(roomId);this.active=undefined;return {...base,state:'waiting',message:`${frame.roomName} · 새 슈 첫 결과 대기`};}
    const previous=this.store.snapshot(roomId);
    const known=previous.roomId===roomId?previous.results:[];
    const matches=known.every((r,i)=>frame.outcomes[i]===r.outcome);
    const resumed=known.length>0&&matches&&!this.resetRooms.has(roomId);
    // A shrinking or changed nonempty board does not prove a shoe reset. Require
    // a stable empty board or explicit user reset instead of mixing two shoes.
    if(known.length&&!resumed&&!this.resetRooms.has(roomId))
      return this.invalid(`${frame.roomName} · 이전 기록과 다릅니다. 슈 초기화/화면 누락 확인 필요`);
    const shoeId=resumed?previous.shoeId!:`자동-${randomUUID()}`;
    this.resetRooms.delete(roomId);
    const uninterrupted=this.active?.roomId===roomId&&this.active.shoeId===shoeId&&
      Date.parse(firstSeen)-Date.parse(this.active.lastSeen)<=6000;
    const added=frame.outcomes.length-(resumed?known.length:0);
    if(added>0){
      this.store.ingest(frame.outcomes.slice(resumed?known.length:0).map((outcome,j)=>{
        const index=(resumed?known.length:0)+j;
        const score=frame.scores?.[index];
        return {roomId,roomName:frame.roomName,shoeId,round:index+1,outcome,confidence:frame.confidence,
          source:'ocr' as const,historical:!uninterrupted,...(score==null?{}:{score})};
      }),firstSeen);
    }
    this.active={roomId,shoeId,lastSeen:frame.observedAt};
    return {...base,shoeId,state:'collecting',changed:added>0,
      message:`${frame.roomName} · ${frame.total}회차까지 자동 수집 · 다음 ${frame.total+1}~${frame.total+4}회차 예측`};
  }
  newShoe(roomName:string){const id=`screen:${createHash('sha256').update(roomName).digest('hex').slice(0,24)}`;this.resetRooms.add(id);this.pause();}
}
