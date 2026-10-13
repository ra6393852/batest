import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AnalyzerStore } from '../../src/main/store';
import { ImageImport } from '../../src/main/image-import';
import type { Outcome } from '../../src/shared/types';
import { shortTieSequence } from '../fixtures/circle-road-bitmap';
let store: AnalyzerStore, folder: string, importer: ImageImport;
const sequence: Outcome[] = ['B', 'P', 'T', 'B', 'B', 'P', 'T'];
const analysis = { outcomes: sequence, confidence: 0.8, bounds: { x: 0, y: 0, width: 10, height: 10 }, warnings: ['확인 필요'], format: 'bead' as const, tieAfter: [] };
beforeEach(async () => { folder = mkdtempSync(join(tmpdir(), 'image-import-')); store = await AnalyzerStore.open(join(folder, 'records.sqlite')); importer = new ImageImport(); });
afterEach(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });
function save(outcomes = sequence, shoeId = 'image-shoe-1', startRound = 1) {
  const review = importer.create(analysis, 'data:image/png;base64,fixture');
  return importer.save({ reviewId: review.id, roomName: '이미지 방', shoeId, startRound, outcomes }, store);
}
describe('confirmed image records', () => {
  it('saves the thirteenth tie as a separate round and forecasts round sixteen', () => {
    const bp = shortTieSequence.filter(outcome => outcome !== 'T');
    const review = importer.create({ ...analysis, outcomes: bp, format: 'big-road', tieAfter: [11] }, 'preview');
    const result = importer.save({ reviewId: review.id, roomName: '15회 그림판', shoeId: 'short-tie', startRound: 1, outcomes: bp, tiesAfter: [{ index: 11, count: 1 }] }, store);
    const snapshot = store.snapshot(result.roomId, result.shoeId);
    expect(result.added).toBe(15); expect(snapshot.results.map(row => row.outcome)).toEqual(shortTieSequence);
    expect(snapshot.results[12]).toMatchObject({ round: 13, outcome: 'T' });
    expect(snapshot.forecasts.filter(f => f.targetRound === 16 && f.horizon === 1)).toHaveLength(4);
    expect(snapshot.stats.comparisons).toBe(0);
  });
  it('requires every big-road tie marker to be confirmed and expands ties in chronological order', () => {
    const review = importer.create({ ...analysis, format: 'big-road', tieAfter: [1, 5] }, 'preview');
    const input = { reviewId: review.id, roomName: '빅로드 방', shoeId: 's1', startRound: 1, outcomes: sequence.map(o => o === 'T' ? 'P' as const : o) };
    expect(() => importer.save(input, store)).toThrow('모두 확인'); expect(store.snapshot().results).toHaveLength(0);
    const result = importer.save({ ...input, tiesAfter: [{ index: 1, count: 2 }, { index: 5, count: 1 }] }, store);
    const saved = store.snapshot(result.roomId, result.shoeId).results;
    expect(saved.map(row => row.outcome)).toEqual(['B','P','T','T','P','B','B','P','T','P']); expect(result.added).toBe(10);
  });
  it('rejects duplicate or out-of-range tie metadata and ties on bead-road records', () => {
    const review = importer.create(analysis, 'preview');
    expect(() => importer.save({ reviewId: review.id, roomName: '방', shoeId: 's', startRound: 1, outcomes: sequence, tiesAfter: [{ index: 1, count: 1 }] }, store)).toThrow('타이 횟수');
    expect(store.snapshot().results).toHaveLength(0);
  });
  it('keeps image recognition out of the database until confirmation and never retrospectively scores', () => {
    const review = importer.create(analysis, 'data:image/png;base64,fixture');
    expect(store.snapshot().results).toHaveLength(0);
    const result = importer.save({ reviewId: review.id, roomName: '이미지 방', shoeId: 's1', startRound: 20, outcomes: sequence }, store);
    const snapshot = store.snapshot(result.roomId, result.shoeId);
    expect(result.added).toBe(7); expect(snapshot.results.map(row => row.round)).toEqual([20, 21, 22, 23, 24, 25, 26]);
    expect(snapshot.results.every(row => row.historical && row.source === 'manual')).toBe(true);
    expect(snapshot.stats.comparisons).toBe(0); expect(snapshot.forecasts.filter(row => row.targetRound === 27)).toHaveLength(4);
  });
  it('deduplicates repeated images and preserves conflicting records for review', () => {
    save(); expect(save().added).toBe(0);
    const result = save(sequence.map((value, index) => index === 0 ? 'P' : value));
    expect(result.added).toBe(0); expect(result.pending).toBe(1); expect(store.snapshot().results[0].outcome).toBe('B');
  });
  it('keeps new shoes independent and imports image updates as unscored history', () => {
    save(); const next = save(sequence, 'image-shoe-1', 8);
    expect(next.added).toBe(7); expect(store.snapshot().stats.comparisons).toBe(0);
    const another = save(sequence, 'image-shoe-2'); expect(another.added).toBe(7); expect(store.snapshot().results).toHaveLength(7);
  });
  it('rejects a stale review or changed result count without saving', () => {
    const old = importer.create(analysis, 'preview'); importer.create(analysis, 'new-preview');
    expect(() => importer.save({ reviewId: old.id, roomName: '방', shoeId: 's', startRound: 1, outcomes: sequence }, store)).toThrow('다시 읽고');
    expect(() => save([...sequence, 'B'])).toThrow('다시 읽고'); expect(store.snapshot().results).toHaveLength(0);
  });
});
