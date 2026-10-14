import {test,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnalyzerStore} from '../../src/main/store';
import {VisibleBoardSession} from '../../src/main/visible-board-session';
import {BackgroundScores,type ScoreFrame} from '../../src/main/background-scores';
import type {Outcome} from '../../src/shared/types';
test('an unresolved digit reader cannot delay new B/P/T results or O/X; late scores preserve frozen answers',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-scores-'));let time=new Date('2026-10-14T01:00:00Z');
  const store=await AnalyzerStore.open(join(folder,'db.sqlite'),()=>time);
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
  try{
    const session=new VisibleBoardSession(store);
    const accept=(text:string)=>{time=new Date(+time+1000);return session.accept({outcomes:text.split('') as Outcome[],confidence:1,observedAt:time.toISOString()});};
    const a='BPPBPBTBP';accept(a);const first=accept(a),before=store.snapshot(first.roomId,first.shoeId);
    const frame=(text:string):ScoreFrame=>({key:text,roomId:first.roomId!,shoeId:first.shoeId!,outcomes:text.split('') as Outcome[],width:1,height:1,bitmap:new Uint8Array(4),cells:[...text].map(()=>({x:0,y:0,width:1,height:1}))});
    const queue=new BackgroundScores(store,async(_w,_h,_b,cells)=>{if(calls++===0)await pending;return {scores:cells.map(()=>9),confidences:cells.map(()=>.99)};},()=>{});
    queue.enqueue(frame(a));expect(calls).toBe(1);
    accept(a+'P');const scored=accept(a+'P');expect(scored.state).toBe('collecting');
    const live=store.snapshot(first.roomId,first.shoeId);expect(live.results).toHaveLength(10);expect(live.stats.advanceAccuracy.A.count).toBe(1);expect(live.stats.advanceAccuracy.A.rate).toBe(0);
    expect(live.results.every(r=>r.score===undefined)).toBe(true);queue.enqueue(frame(a+'P'));
    release();await vi.waitFor(()=>expect(store.snapshot(first.roomId,first.shoeId).results.every(r=>r.score===9)).toBe(true));
    const enriched=store.snapshot(first.roomId,first.shoeId);
    expect(enriched.forecasts.filter(f=>f.cutoffRound===9).map(f=>f.id)).toEqual(before.forecasts.map(f=>f.id));
    expect(enriched.forecasts.map(f=>({id:f.id,pick:f.pick,probabilities:f.probabilities,mark:f.mark}))).toEqual(live.forecasts.map(f=>({id:f.id,pick:f.pick,probabilities:f.probabilities,mark:f.mark})));
    expect(enriched.results.map(r=>r.id)).toEqual(live.results.map(r=>r.id));expect(enriched.stats.advanceAccuracy).toEqual(live.stats.advanceAccuracy);
  }finally{release();store.close();rmSync(folder,{recursive:true,force:true});}
});
test('reset discards stale digit work and the queue keeps only the newest pending frame',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-scores-reset-')),store=await AnalyzerStore.open(join(folder,'db.sqlite'));
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
  try{
    const rows=(roomId:string,text:string)=>[...text].map((outcome,i)=>({roomId,roomName:roomId,shoeId:'shoe',round:i+1,outcome:outcome as Outcome,confidence:1,source:'ocr' as const,historical:true}));
    store.ingest(rows('old','BP'));store.ingest(rows('current','PPB'));
    const frame=(roomId:string,key:string,text:string):ScoreFrame=>({key,roomId,shoeId:'shoe',outcomes:text.split('') as Outcome[],width:1,height:1,bitmap:new Uint8Array(4),cells:[...text].map(()=>({x:0,y:0,width:1,height:1}))});
    const queue=new BackgroundScores(store,async(_w,_h,_b,cells)=>{if(calls++===0)await pending;return {scores:cells.map(()=>7),confidences:cells.map(()=>.99)};},()=>{});
    queue.enqueue(frame('old','first','BP'));queue.reset();queue.enqueue(frame('current','dropped','PP'));queue.enqueue(frame('current','latest','PPB'));
    release();await vi.waitFor(()=>expect(store.snapshot('current','shoe').results.every(r=>r.score===7)).toBe(true));
    expect(calls).toBe(2);expect(store.snapshot('old','shoe').results.every(r=>r.score===undefined)).toBe(true);
    queue.enqueue(frame('current','latest','PPB'));expect(calls).toBe(2);
  }finally{release();store.close();rmSync(folder,{recursive:true,force:true});}
});
