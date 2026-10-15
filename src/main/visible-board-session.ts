import type { Outcome } from '../shared/types';
import type { AnalyzerStore } from './store';
import { LiveSession, type LiveFrame, type LiveUpdate } from './live-session';
export type BoardFrame = Omit<LiveFrame, 'roomName'|'total'|'complete'>;
// Screen-only mode: numbers are relative to the visible board. A changed prefix
// is a new analysis group, rather than an inferred provider room or shoe ID.
export class VisibleBoardSession {
  private live:LiveSession;
  private name:string;
  private previous:Outcome[]=[];
  private transition?:{key:string;frame:BoardFrame};
  constructor(private store:AnalyzerStore){this.name=this.nextName();this.live=new LiveSession(store);}
  private nextName(){const numbers=this.store.snapshot().rooms.map(r=>Number(r.name.match(/^그림판 (\d+)$/)?.[1]??0));return `그림판 ${Math.max(0,...numbers)+1}`;}
  private row(frame:BoardFrame):LiveFrame {return {...frame,roomName:this.name,total:frame.outcomes.length,complete:true};}
  pause(){this.transition=undefined;this.live.pause();}
  invalid(message:string){this.transition=undefined;return this.live.hold(this.name,message);}
  newBoard(){this.name=this.nextName();this.previous=[];this.transition=undefined;this.live=new LiveSession(this.store);}
  accept(frame:BoardFrame):LiveUpdate {
    if(frame.confidence<.92)return this.invalid('그림판 색상이 불확실합니다. 다음 이미지를 확인 중입니다.');
    const changed=this.previous.length>0&&!this.previous.every((o,i)=>frame.outcomes[i]===o);
    if(changed){
      const key=JSON.stringify(frame.outcomes);
      if(this.transition?.key!==key){this.transition={key,frame};return {state:'waiting',message:'그림판 내용 변경 · 같은 이미지를 한 번 더 확인 중'};}
      const first=this.transition.frame;this.newBoard();
      this.live.accept(this.row(first));
    }else this.transition=undefined;
    const update=this.live.accept(this.row(frame));
    if(update.state==='collecting')this.previous=[...frame.outcomes];
    return {...update,message:update.state==='collecting'
      ?`보이는 ${this.name} · ${frame.outcomes.length}개 결과 수집 · 다음 ${frame.outcomes.length+1}~${frame.outcomes.length+4} 기록 예측`
      :frame.outcomes.length===0?'빈 그림판 · 첫 결과 대기':update.message};
  }
}
