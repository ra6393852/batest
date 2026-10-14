import {test,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnalyzerStore} from '../../src/main/store';
import {VisibleBoardSession} from '../../src/main/visible-board-session';
import {doubleBitmap} from '../../src/collector/double-bitmap';
import {analyzeBeadBitmap} from '../../src/collector/bead-image';
import {smallRoadBitmap,exampleOutcomes} from '../fixtures/road-bitmap';
import type {Outcome} from '../../src/shared/types';
test('visible boards need no provider identity and grade only new results in their own group',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'baccarat-visible-'));let time=new Date('2026-10-14T01:00:00Z');
  const store=await AnalyzerStore.open(join(folder,'db.sqlite'),()=>time);
  try{
    const session=new VisibleBoardSession(store);
    const frame=(text:string)=>{time=new Date(+time+1000);return {outcomes:text.split('') as Outcome[],confidence:1,observedAt:time.toISOString()};};
    const a='BPPBPBTBP';session.accept(frame(a));const initial=session.accept(frame(a));
    expect(initial.state).toBe('collecting');expect(initial.roomName).toBe('그림판 1');
    const old=store.snapshot(initial.roomId,initial.shoeId);expect(old.results.every(r=>r.historical)).toBe(true);
    session.accept(frame(a+'B'));session.accept(frame(a+'B'));
    expect(store.snapshot(initial.roomId,initial.shoeId).stats.advanceAccuracy.A.rate).toBe(1);
    expect(session.accept(frame('PPPTBP')).state).toBe('waiting');const other=session.accept(frame('PPPTBP'));
    expect(other.roomId).not.toBe(initial.roomId);expect(other.roomName).toBe('그림판 2');
    expect(store.snapshot(other.roomId,other.shoeId).results).toHaveLength(6);
    expect(store.snapshot(other.roomId,other.shoeId).stats.advanceComparisons).toBe(0);
    expect(store.snapshot(initial.roomId,initial.shoeId).results).toHaveLength(10);
    expect(store.snapshot(initial.roomId,initial.shoeId).forecasts.filter(f=>f.cutoffRound===9).map(f=>f.id)).toEqual(old.forecasts.map(f=>f.id));
    session.newBoard();session.accept(frame('PPPTBP'));const reset=session.accept(frame('PPPTBP'));expect(reset.roomName).toBe('그림판 3');
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
test('exact twofold sensor preserves pixel colors and recognizes the six-row bead order',()=>{
  const source=smallRoadBitmap('bead'),out=doubleBitmap(source.width,source.height,source.bitmap);
  expect(out.width).toBe(source.width*2);expect(out.height).toBe(source.height*2);
  for(const [x,y] of [[0,0],[15,25],[34,50]])for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const p=((y*2+dy)*out.width+x*2+dx)*4;
    expect([...out.bitmap.slice(p,p+4)]).toEqual([...source.bitmap.slice((y*source.width+x)*4,(y*source.width+x)*4+4)]);
  }
  expect(analyzeBeadBitmap(out.width,out.height,out.bitmap,true).outcomes).toEqual(exampleOutcomes);
  expect(()=>doubleBitmap(10,10,new Uint8Array(1))).toThrow('크기');
});
