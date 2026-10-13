import { describe, expect, it } from 'vitest';
import { parseSequence, simulateHistory } from '../../src/analysis/simulation';
import { analyze } from '../../src/analysis/engine';
import { exampleOutcomes } from '../fixtures/road-bitmap';
describe('manual history simulation', () => {
  it('parses only B/P/T and rejects numbers or other text', () => {
    expect(parseSequence('b, P / T\nB')).toEqual(['B','P','T','B']);
    expect(() => parseSequence('B 2 P')).toThrow(); expect(() => parseSequence('')).toThrow();
  });
  it('starts with ten results and compares the same 28 targets for all methods', () => {
    const result = simulateHistory(exampleOutcomes);
    expect(result.stats.total).toBe(38); expect(result.stats.comparisons).toBe(28);
    expect(result.stats.counts).toEqual({ B: 19, P: 16, T: 3 });
    expect(result.forecasts).toHaveLength(112);
    for (const method of ['A','B','C','D'] as const) expect(result.stats.accuracy[method].all.count).toBe(28);
  });
  it('does not change an earlier forecast when later results change', () => {
    const first = simulateHistory(exampleOutcomes), changed = simulateHistory([...exampleOutcomes.slice(0, 20), 'T', 'T', 'T']);
    expect(first.forecasts.filter(f => f.targetRound === 20)).toEqual(changed.forecasts.filter(f => f.targetRound === 20));
    expect(first.forecasts.filter(f => f.targetRound === 11).map(f => f.probabilities)).toEqual(analyze(exampleOutcomes.slice(0, 10)).map(m => m.probabilities));
  });
  it('produces the next estimates without inventing scored targets for short history', () => {
    const result = simulateHistory(['B']); expect(result.stats.comparisons).toBe(0); expect(result.next).toHaveLength(4);
  });
});
