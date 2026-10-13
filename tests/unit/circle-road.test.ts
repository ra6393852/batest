import { describe, expect, it } from 'vitest';
import { analyzeBeadBitmap, ImageRecognitionError } from '../../src/collector/bead-image';
import { circleRoadBitmap, circleSequence } from '../fixtures/circle-road-bitmap';

describe('circle-first big-road recognition', () => {
  it.each([12, 18.6, 23.4])('reads antialiased rings without any grey grid at pitch %s', pitch => {
    const image = circleRoadBitmap(circleSequence, pitch);
    const result = analyzeBeadBitmap(image.width, image.height, image.bitmap);
    expect(result.format).toBe('big-road');
    expect(result.outcomes).toEqual(circleSequence.filter(outcome => outcome !== 'T'));
    expect(result.tieAfter).toEqual([10, 17]);
    expect(result.diagnostics).toMatchObject({ gridCandidates: 0, stage: 'complete' });
    expect(result.diagnostics!.circleCandidates).toBeGreaterThanOrEqual(7);
    expect(result.diagnostics!.detail).toContain('원');
  });
  it('uses circle centers when dividers are too faint for the grey-line detector', () => {
    const image = circleRoadBitmap(circleSequence, 18.6, true);
    expect(analyzeBeadBitmap(image.width, image.height, image.bitmap).outcomes).toEqual(circleSequence.filter(outcome => outcome !== 'T'));
  });
  it('rejects an occluded final circle instead of returning an earlier prefix', () => {
    const image = circleRoadBitmap(), circle = image.centers.at(-1)!;
    for (let y = Math.floor(circle.y - 10); y <= circle.y + 10; y++) for (let x = Math.floor(circle.x); x <= circle.x + 10; x++) image.bitmap.set([230,230,230,255], (y * image.width + x) * 4);
    expect(() => analyzeBeadBitmap(image.width, image.height, image.bitmap)).toThrow('찾지 못했습니다');
  });
  it('rejects a chart with its sixth row cropped off', () => {
    const image = circleRoadBitmap(), height = Math.round(3 + 5 * 18.6);
    expect(() => analyzeBeadBitmap(image.width, height, image.bitmap.slice(0, image.width * height * 4))).toThrow('찾지 못했습니다');
  });
  it('reports exact detection counts without issuing outcomes for blank images', () => {
    try { analyzeBeadBitmap(100, 100, new Uint8Array(40000).fill(255)); throw new Error('expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(ImageRecognitionError);
      expect((error as ImageRecognitionError).diagnostics).toMatchObject({ width: 100, height: 100, coloredPixels: 0, gridCandidates: 0, circleCandidates: 0, circleGrids: 0, stage: 'color' });
    }
  });
  it('requires a choice instead of merging two independent big roads', () => {
    const image = circleRoadBitmap(), width = image.width * 2 + 40;
    const bitmap = new Uint8Array(width * image.height * 4).fill(255);
    for (let y = 0; y < image.height; y++) {
      const row = image.bitmap.slice(y * image.width * 4, (y + 1) * image.width * 4);
      bitmap.set(row, y * width * 4); bitmap.set(row, (y * width + image.width + 40) * 4);
    }
    expect(() => analyzeBeadBitmap(width, image.height, bitmap)).toThrow('여러 빅로드');
  });
});
