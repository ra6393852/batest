import { describe,it,expect } from 'vitest';
import { AnalyzerStore } from '../../src/main/store';
import { LiveSession,type LiveFrame } from '../../src/main/live-session';
import { roomFromLines,countFromLines } from '../../src/collector/window-text';
import { analyzeBeadBitmap } from '../../src/collector/bead-image';
import { beadColorConfidence } from '../../src/collector/frame-color';
import { smallRoadBitmap,exampleOutcomes } from '../fixtures/road-bitmap';
import type { Outcome } from '../../src/shared/types';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
describe('automatic visual room collection',()=>{
  it('normalizes table names without mixing Korean and international tables, and rejects ambiguous labels',()=>{
    expect(roomFromLines([{text:'Speed Baccarat A $10',confidence:95}])).toBe('스피드 바카라 A');
    expect(roomFromLines([{text:'코리안 스피드 바카라 G ₩10,000',confidence:95}])).toBe('코리안 스피드 바카라 G');
    expect(roomFromLines([{text:'코리안스피드바카라G ₩10,000',confidence:95}])).toBe('코리안 스피드 바카라 G');
    expect(roomFromLines([{text:'Speed Baccarat 4',confidence:95}])).toBeNull();
    expect(roomFromLines([{text:'Speed Baccarat A',confidence:70}])).toBeNull();
    expect(roomFromLines([{text:'Speed Baccarat A Speed Baccarat B',confidence:95}])).toBeNull();
    expect(countFromLines([{text:'# 57 P 32 B 23 T 2',confidence:90}])).toBe(57);
    expect(countFromLines([{text:'# 23:10:26',confidence:95},{text:'# 57',confidence:95}])).toBe(57);
  });
  it('reads a filled bead board alongside a hollow big road in automatic mode and measures its ink',()=>{
    const image=smallRoadBitmap('bead');
    const result=analyzeBeadBitmap(image.width,image.height,image.bitmap,true);
    expect(result.outcomes).toEqual(exampleOutcomes);expect(result.completeGrid).toBe(true);
    expect(Math.min(...beadColorConfidence(image.width,image.bitmap,result.beadCells!,result.outcomes))).toBeGreaterThan(.92);
    expect(analyzeBeadBitmap(image.width,image.height,image.bitmap,true,true).outcomes).toEqual(exampleOutcomes);
    const empty=smallRoadBitmap('bead',false,[]);
    expect(analyzeBeadBitmap(empty.width,empty.height,empty.bitmap,true,true).outcomes).toEqual([]);
  });
  it('restores B independently, scores only continuously observed new results and preserves A when switching',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'baccarat-live-'));let time=new Date('2026-10-14T01:00:00Z');const store=await AnalyzerStore.open(join(folder,'db.sqlite'),()=>time);
    try{
      const live=new LiveSession(store),initial='BPPBPBTBPPBPBBPPBPBPPB'.split('') as Outcome[];
      const accept=(roomName:string,outcomes:Outcome[],extra:Partial<LiveFrame>={})=>{time=new Date(+time+1000);return live.accept({roomName,outcomes,total:outcomes.length,complete:true,confidence:1,observedAt:time.toISOString(),...extra});};
      expect(accept('스피드 바카라 A',initial).state).toBe('waiting');const a=accept('스피드 바카라 A',initial);
      expect(a.state).toBe('collecting');const frozen=store.snapshot(a.roomId,a.shoeId).forecasts;
      const next=[...initial,'B' as Outcome];accept('스피드 바카라 A',next);accept('스피드 바카라 A',next);
      const scored=store.snapshot(a.roomId,a.shoeId);expect(scored.stats.advanceAccuracy.A.count).toBe(1);expect(scored.stats.advanceAccuracy.A.rate).toBe(1);
      const bHistory='PPPTBPBBPTB'.split('') as Outcome[];accept('스피드 바카라 B',bHistory);const b=accept('스피드 바카라 B',bHistory);
      const bs=store.snapshot(b.roomId,b.shoeId);expect(bs.results.map(r=>r.outcome)).toEqual(bHistory);expect(bs.forecasts).toHaveLength(16);expect(bs.stats.total).toBe(11);expect(bs.stats.advanceComparisons).toBe(0);
      expect(store.snapshot(a.roomId,a.shoeId).forecasts.filter(f=>f.cutoffRound===22).map(f=>f.id)).toEqual(frozen.map(f=>f.id));
      const unseen=[...next,'P' as Outcome];accept('스피드 바카라 A',unseen);const returned=accept('스피드 바카라 A',unseen);
      expect(returned.shoeId).toBe(a.shoeId);expect(store.snapshot(a.roomId,a.shoeId).results.at(-1)?.historical).toBe(true);
      expect(store.snapshot(a.roomId,a.shoeId).stats.advanceAccuracy.A.count).toBe(1);
      const newer=[...unseen,'T' as Outcome];accept('스피드 바카라 A',newer);accept('스피드 바카라 A',newer);
      expect(store.snapshot(a.roomId,a.shoeId).stats.advanceAccuracy.A.count).toBeGreaterThan(1);
    }finally{store.close();rmSync(folder,{recursive:true,force:true});}
  });
  it('requires stable empty/reset evidence, rejects cropped history, and treats restart backfill as historical',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'baccarat-live-'));let time=new Date('2026-10-14T02:00:00Z');const store=await AnalyzerStore.open(join(folder,'db.sqlite'),()=>time);
    try{
      const history='BPPTBBP'.split('') as Outcome[];let live=new LiveSession(store);
      const accept=(outcomes:Outcome[],extra:Partial<LiveFrame>={})=>{time=new Date(+time+1000);return live.accept({roomName:'바카라 A',outcomes,total:outcomes.length,complete:true,confidence:1,observedAt:time.toISOString(),...extra});};
      accept(history);const a=accept(history);expect(a.state).toBe('collecting');
      live=new LiveSession(store);accept([...history,'P']);accept([...history,'P']);expect(store.snapshot(a.roomId,a.shoeId).results.at(-1)?.historical).toBe(true);
      expect(accept(history,{total:20}).state).toBe('blocked');expect(store.snapshot(a.roomId,a.shoeId).stats.total).toBe(8);
      accept(['T']);expect(accept(['T']).state).toBe('blocked');
      accept([]);accept([]);accept(['T']);const reset=accept(['T']);expect(reset.state).toBe('collecting');expect(reset.shoeId).not.toBe(a.shoeId);
      expect(store.snapshot(reset.roomId,reset.shoeId).results).toHaveLength(1);expect(store.snapshot(a.roomId,a.shoeId).results).toHaveLength(8);
    }finally{store.close();rmSync(folder,{recursive:true,force:true});}
  });
});
