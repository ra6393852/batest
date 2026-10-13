import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { AnalyzerStore } from '../../src/main/store';
import type { Observation } from '../../src/shared/types';
let store: AnalyzerStore, folder: string, file: string, time: number;
const sample = (round: number, extra: Partial<Observation> = {}): Observation => ({ roomId: 'room-a', roomName: 'Alpha', shoeId: 'shoe-1', round,
  outcome: 'B', confidence: 1, source: 'demo', historical: false, ...extra });
const tick = () => { time += 1000; };
beforeEach(async () => { folder = mkdtempSync(join(tmpdir(), 'baccarat-store-')); file = join(folder, 'test.sqlite'); time = Date.parse('2026-01-01T00:00:00.000Z');
  store = await AnalyzerStore.open(file, () => new Date(time)); });
afterEach(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });
describe('SQLite results and immutable forecasts', () => {
  it('persists results and forecasts across a restart', async () => {
    store.ingest([sample(1)]); store.close(); store = await AnalyzerStore.open(file, () => new Date(time));
    expect(store.snapshot().results).toHaveLength(1); expect(store.snapshot().forecasts).toHaveLength(16);
    expect(readFileSync(file).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
  it('deduplicates a round and stages conflicting observations without overwriting', () => {
    store.ingest([sample(1)]); store.ingest([sample(1)]); store.ingest([sample(1, { outcome: 'P' })]);
    const s = store.snapshot(); expect(s.results).toHaveLength(1); expect(s.results[0].outcome).toBe('B'); expect(s.pending).toHaveLength(1);
    expect(() => store.confirm(s.pending[0].id, true)).toThrow(/기존 결과/);
    store.confirm(s.pending[0].id, false); expect(store.snapshot().pending).toHaveLength(0);
  });
  it('separates rooms, shoe resets and retains earlier records', () => {
    store.ingest([sample(1), sample(1, { roomId: 'room-b', roomName: 'Beta' }), sample(1, { shoeId: 'shoe-2', outcome: 'P' })]);
    expect(store.snapshot().rooms).toHaveLength(2);
    expect(store.snapshot('room-a', 'shoe-1').results[0].outcome).toBe('B');
    expect(store.snapshot('room-a', 'shoe-2').results[0].outcome).toBe('P');
    expect(store.snapshot('room-b').results).toHaveLength(1);
  });
  it('stages both outcomes from an inconsistent snapshot instead of choosing the first', () => {
    store.ingest([sample(1), sample(1, { outcome: 'P' })]);
    expect(store.snapshot().results).toHaveLength(0); expect(store.snapshot().pending).toHaveLength(2);
  });
  it('stages low-confidence results and confirms them once', () => {
    store.ingest([sample(1, { confidence: 0.7 })]); expect(store.snapshot().results).toHaveLength(0);
    const id = store.snapshot().pending[0].id; tick(); store.confirm(id, true);
    expect(store.snapshot().results).toHaveLength(1); expect(() => store.confirm(id, true)).toThrow();
  });
  it('scores the frozen next and advance forecasts, preserving both versions', () => {
    store.ingest([sample(30)]); const early = store.snapshot().forecasts.find(f => f.targetRound === 32 && f.method === 'B')!;
    tick(); store.ingest([sample(31, { outcome: 'P' })]);
    const s = store.snapshot(); expect(s.forecasts.filter(f => f.targetRound === 31)).toHaveLength(4);
    expect(s.forecasts.filter(f => f.targetRound === 31).every(f => f.mark === 'X')).toBe(true);
    expect(s.forecasts.filter(f => f.targetRound === 32)).toHaveLength(8);
    expect(s.forecasts.find(f => f.id === early.id)).toEqual(early);
    tick(); store.ingest([sample(32)]);
    expect(store.snapshot().forecasts.filter(f => f.targetRound === 32).every(f => f.actual === 'B')).toBe(true);
    expect(store.snapshot().stats.comparisons).toBe(2);
  });
  it('does not forecast with any later rows from the same snapshot', () => {
    store.ingest([sample(1), sample(2, { outcome: 'P' }), sample(3)]);
    const fs = store.snapshot().forecasts;
    expect(fs.every(f => f.cutoffRound === 3 && f.targetRound > 3)).toBe(true);
    expect(fs.every(f => f.actual === undefined)).toBe(true);
  });
  it('imports visible history without retrospective scoring, but forecasts the next unknown round', () => {
    store.ingest([sample(1)]); tick(); store.ingest([sample(2, { historical: true }), sample(3, { historical: true })]);
    expect(store.snapshot().forecasts.filter(f => f.targetRound <= 3).every(f => !f.mark)).toBe(true);
    expect(store.snapshot().forecasts.some(f => f.targetRound === 4)).toBe(true);
  });
  it('does not score results whose known occurrence predates the prediction', () => {
    store.ingest([sample(1)]); tick(); store.ingest([sample(2, { occurredAt: '2025-12-31T23:59:59.000Z' })]);
    expect(store.snapshot().forecasts.filter(f => f.targetRound === 2).every(f => !f.mark)).toBe(true);
  });
  it('uses first-seen time when confirming pending results', () => {
    store.ingest([sample(1), sample(2, { confidence: 0.8 })]);
    expect(store.snapshot().forecasts).toHaveLength(0);
    tick(); store.confirm(store.snapshot().pending[0].id, true);
    expect(store.snapshot().forecasts.every(f => f.targetRound > 2)).toBe(true);
  });
  it('scores low-confidence results only against predictions saved before first observation', () => {
    store.ingest([sample(1)]); tick(); store.ingest([sample(2, { confidence: 0.4, outcome: 'T' })]);
    tick(); store.confirm(store.snapshot().pending[0].id, true);
    const a = store.snapshot().stats.accuracy.A.all;
    expect(a.count).toBe(1); expect(a.correct).toBe(0); expect(a.noTieCount).toBe(0); expect(a.noTieRate).toBeNull();
  });
  it('rejects invalid rounds and stages future timestamps', () => {
    expect(() => store.ingest([sample(0)])).toThrow();
    store.ingest([sample(1, { occurredAt: '2030-01-01T00:00:00.000Z' })]); expect(store.snapshot().results).toHaveLength(0);
    expect(() => store.confirm(store.snapshot().pending[0].id, true)).toThrow(/미래/);
  });
  it('does not combine patterns across missing rounds', () => {
    store.ingest([sample(1)]); tick(); store.ingest([sample(4, { outcome: 'P' })]);
    const f = store.snapshot().forecasts.find(f => f.cutoffRound === 4 && f.method === 'B')!;
    expect(f.sampleSize).toBe(1);
  });
  it('prevents DB updates to frozen forecasts, results and scores', async () => {
    store.ingest([sample(1)]); tick(); store.ingest([sample(2)]);
    const sql = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }); const db = new sql.Database(readFileSync(file));
    expect(() => db.run("UPDATE forecasts SET pick='P'")).toThrow(/immutable/);
    expect(() => db.run("DELETE FROM forecasts")).toThrow(/immutable/);
    expect(() => db.run("UPDATE results SET outcome='P'")).toThrow(/immutable/);
    expect(() => db.run("UPDATE settlements SET mark='X'")).toThrow(/immutable/); db.close();
  });
  it('exports all results and predictions with formula injection protection', () => {
    store.ingest([sample(1, { roomName: '=HYPERLINK("bad")' })]);
    const csv = store.csv('room-a', 'shoe-1'); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('"horizon"');
    expect(csv.split('\r\n')).toHaveLength(18);
    expect(() => store.csv('missing', 'shoe-1')).toThrow();
  });
});
