import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { AnalyzerStore } from '../../src/main/store';
import { BASE, accuracy } from '../../src/analysis/engine';
import type { Observation } from '../../src/shared/types';
describe('four-round forecast retention, grading and upgrade', () => {
  it('freezes all 16 picks at round 22, scores 23–26 and generates 27–30 separately', async () => {
    const folder=mkdtempSync(join(tmpdir(),'four-round-')); let time=Date.parse('2026-01-01T00:00:00Z');
    const store=await AnalyzerStore.open(join(folder,'records.sqlite'),()=>new Date(time));
    const observation=(round:number,outcome:Observation['outcome'],historical=false):Observation=>({roomId:'r',roomName:'r',shoeId:'s',round,outcome,historical,confidence:1,source:'manual',score:round%10});
    try {
      store.ingest(Array.from({length:22},(_,i)=>observation(i+1,i%2?'P':'B',true)));
      const frozen=store.snapshot().forecasts.filter(f=>f.cutoffRound===22);
      expect(frozen).toHaveLength(16); expect([...new Set(frozen.map(f=>f.targetRound))].sort()).toEqual([23,24,25,26]);
      for (const [i,outcome] of (['B','P','T','B'] as const).entries()) {time+=1000;store.ingest([observation(23+i,outcome)]);}
      const snapshot=store.snapshot(), graded=snapshot.forecasts.filter(f=>f.cutoffRound===22);
      expect(graded.every(f=>f.actual!==undefined&&f.mark===(f.actual===f.pick?'O':'X'))).toBe(true);
      expect(graded.map(({actual,mark,...f})=>f).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(frozen.map(({actual,mark,...f})=>f).sort((a,b)=>a.id.localeCompare(b.id)));
      expect(accuracy(graded.filter(f=>f.method==='A')).rate).toBe(0.5);
      expect(snapshot.stats.advanceComparisons).toBe(10); expect(snapshot.stats.advanceAccuracy.A.rate).toBe(0.5);
      expect(snapshot.forecasts.filter(f=>f.cutoffRound===26)).toHaveLength(16);
      expect(snapshot.forecasts.filter(f=>f.cutoffRound===26).every(f=>f.targetRound>=27&&f.targetRound<=30&&!f.actual)).toBe(true);
      store.ingest([observation(26,'B',true)]); expect(store.snapshot().stats.advanceComparisons).toBe(10);
    } finally {store.close();rmSync(folder,{recursive:true,force:true});}
  });
  it('upgrades an existing version-1 DB without losing immutable predictions or settlements', async () => {
    const folder=mkdtempSync(join(tmpdir(),'four-upgrade-')), file=join(folder,'records.sqlite');
    const sql=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')}), old=new sql.Database();
    old.run(readFileSync(join(process.cwd(),'tests/fixtures/store-v1.sql'),'utf8'));
    old.run("INSERT INTO rooms VALUES('r','r','2026-01-01'); INSERT INTO results VALUES('r1','r','s',1,'B',1,'manual',0,NULL,'2026-01-01T00:00:00Z'); INSERT INTO results VALUES('r2','r','s',2,'P',1,'manual',0,NULL,'2026-01-01T00:00:02Z');");
    old.run('INSERT INTO forecasts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['f1','r','s',2,1,1,'A',JSON.stringify(BASE),'B',0,'legacy','2026-01-01T00:00:01Z']);
    old.run("INSERT INTO settlements VALUES('f1','r2','P','X','2026-01-01T00:00:02Z')");
    writeFileSync(file,old.export());old.close();
    const store=await AnalyzerStore.open(file,()=>new Date('2026-01-01T00:00:03Z'));
    try {
      const snapshot=store.snapshot();expect(snapshot.results).toHaveLength(2);
      expect(snapshot.forecasts.find(f=>f.id==='f1')).toMatchObject({basis:'legacy',pick:'B',actual:'P',mark:'X',horizon:1});
      expect(snapshot.forecasts.filter(f=>f.cutoffRound===2)).toHaveLength(16);
      store.ingest([{roomId:'r',roomName:'r',shoeId:'s',round:2,outcome:'P',historical:true,confidence:1,source:'manual',score:9}]);
      expect(store.snapshot().results[1].score).toBe(9);
      const db=new sql.Database(readFileSync(file));expect(db.exec('PRAGMA foreign_key_check')).toEqual([]);
      expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(2);
      expect(()=>db.run("UPDATE forecasts SET pick='P'")).toThrow('immutable');
      expect(()=>db.run('UPDATE result_scores SET score=0')).toThrow('immutable');db.close();
    } finally {store.close();rmSync(folder,{recursive:true,force:true});}
  });
});
