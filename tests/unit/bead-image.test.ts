import { describe, expect, it } from 'vitest';
import { analyzeBeadBitmap } from '../../src/collector/bead-image';
import type { Outcome } from '../../src/shared/types';
import { smallRoadBitmap, exampleOutcomes } from '../fixtures/road-bitmap';
function fixture(boards: Array<{ x: number; y: number; outcomes: (Outcome | null)[]; hollow?: boolean }>, size = 650) {
  const width = size, height = 400, bitmap = new Uint8Array(width * height * 4).fill(255);
  const colors = { B: [20, 30, 240], P: [245, 140, 20], T: [40, 190, 20] };
  for (const board of boards) board.outcomes.forEach((outcome, index) => {
    if (!outcome) return;
    const cx = board.x + Math.floor(index / 6) * 36, cy = board.y + (index % 6) * 36;
    for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 12; x++) {
      const distance = (x - cx) ** 2 + (y - cy) ** 2;
      if (distance > 144 || (board.hollow && distance < 110) || x < 0 || y < 0 || x >= width || y >= height) continue;
      bitmap.set([...colors[outcome], 255], (y * width + x) * 4);
    }
    // White letter strokes within each filled bead.
    if (!board.hollow) for (let y = cy - 5; y <= cy + 5; y++) bitmap.set([255, 255, 255, 255], (y * width + cx) * 4);
  });
  return { width, height, bitmap };
}
const sequence: Outcome[] = ['B', 'P', 'T', 'B', 'B', 'P', 'T', 'P', 'B', 'P', 'B', 'T', 'P'];
describe('read-only bead-road image analysis', () => {
  it('reads small grey-grid beads with large white letters and pair marks', () => {
    const image = smallRoadBitmap('bead');
    const result = analyzeBeadBitmap(image.width, image.height, image.bitmap);
    expect(result.format).toBe('bead'); expect(result.outcomes).toEqual(exampleOutcomes);
    expect(result.outcomes.filter(x => x === 'B')).toHaveLength(19); expect(result.outcomes.filter(x => x === 'P')).toHaveLength(16); expect(result.outcomes.filter(x => x === 'T')).toHaveLength(3);
  });
  it('separates touching same-color beads by grid cells', () => {
    const image = smallRoadBitmap('bead', true);
    expect(analyzeBeadBitmap(image.width, image.height, image.bitmap).outcomes).toEqual(exampleOutcomes);
  });
  it('reads the hollow big-road runs and requires review of green tie markers', () => {
    const image = smallRoadBitmap('big-road');
    const result = analyzeBeadBitmap(image.width, image.height, image.bitmap);
    expect(result.format).toBe('big-road'); expect(result.outcomes).toEqual(exampleOutcomes.filter(x => x !== 'T'));
    expect(result.tieAfter).toHaveLength(2);
  });
  it('reads six rows down each column, including the partial final column', () => {
    const image = fixture([{ x: 130, y: 80, outcomes: sequence }]);
    const result = analyzeBeadBitmap(image.width, image.height, image.bitmap);
    expect(result.outcomes).toEqual(sequence); expect(result.confidence).toBeLessThan(0.92);
    expect(result.bounds.x).toBeGreaterThan(100); expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('ignores hollow big-road circles next to filled bead-road results', () => {
    const image = fixture([{ x: 50, y: 50, outcomes: sequence }, { x: 350, y: 50, outcomes: sequence, hollow: true }]);
    expect(analyzeBeadBitmap(image.width, image.height, image.bitmap).outcomes).toEqual(sequence);
  });
  it('requires a choice when two independent bead roads are equally plausible', () => {
    const image = fixture([{ x: 50, y: 50, outcomes: sequence }, { x: 350, y: 50, outcomes: sequence }]);
    expect(() => analyzeBeadBitmap(image.width, image.height, image.bitmap)).toThrow('여러 비드로드');
  });
  it('rejects a gap instead of converting a later suffix into a complete history', () => {
    const image = fixture([{ x: 80, y: 80, outcomes: sequence.map((outcome, index) => index === 2 ? null : outcome) }]);
    expect(() => analyzeBeadBitmap(image.width, image.height, image.bitmap)).toThrow('찾지 못했습니다');
  });
  it('does not treat a hollow roadmap or unrecognizable image as results', () => {
    const image = fixture([{ x: 80, y: 80, outcomes: sequence, hollow: true }]);
    expect(() => analyzeBeadBitmap(image.width, image.height, image.bitmap)).toThrow('찾지 못했습니다');
  });
  it('rejects malformed buffers and oversized images before scanning', () => {
    expect(() => analyzeBeadBitmap(10, 10, new Uint8Array(1))).toThrow('픽셀');
    expect(() => analyzeBeadBitmap(5000, 5000, new Uint8Array(1))).toThrow('픽셀');
  });
});
