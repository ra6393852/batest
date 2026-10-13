import { describe, expect, it } from 'vitest';
import { analyze, analyzeTwoAhead, BASE, statistics, streak, accuracy } from '../../src/analysis/engine';
import type { Forecast, Outcome } from '../../src/shared/types';
describe('causal probability models', () => {
  it('uses the published 8-deck baseline with normalized distributions', () => {
    expect(analyze(['P', 'P', 'T'])[0].probabilities).toEqual(BASE);
    for (const seq of [[], ['B'], Array(100).fill('P'), ['B', 'T', 'P', 'B']] as Outcome[][]) {
      for (const m of analyze(seq)) { expect(Object.values(m.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
        expect(Math.min(...Object.values(m.probabilities))).toBeGreaterThan(0); }
    }
  });
  it('limits recent model to 20 observations and smooths extreme samples', () => {
    const models = analyze([...Array(40).fill('B'), ...Array(20).fill('P')]);
    expect(models[1].sampleSize).toBe(20); expect(models[1].pick).toBe('P');
    expect(models[1].probabilities.P).toBeLessThan(1);
  });
  it('only uses observed next results for C and D, never the unresolved tail', () => {
    const m = analyze(['B', 'P', 'B', 'P', 'B']);
    expect(m[2].sampleSize).toBe(2); expect(m[3].sampleSize).toBe(1);
    expect(m[2].probabilities.P).toBeGreaterThan(BASE.P);
    expect(m[3].probabilities.P).toBeGreaterThan(BASE.P);
  });
  it('ties do not break B/P streaks or count as transitions', () => {
    expect(streak(['B', 'T', 'B', 'T'])).toEqual({ outcome: 'B', length: 2 });
    const s = statistics(['B', 'T', 'B', 'P', 'P', 'T'], []);
    expect(s.longest).toEqual({ B: 2, P: 2 }); expect(s.transitions).toBe(1);
    expect(s.counts).toEqual({ B: 2, P: 2, T: 2 });
  });
  it('keeps no-data rates undefined and excludes only actual ties', () => {
    expect(accuracy([]).rate).toBeNull();
    const forecasts = [{ actual: 'T', mark: 'X', probabilities: BASE }, { actual: 'B', mark: 'O', probabilities: BASE }] as Forecast[];
    const a = accuracy(forecasts); expect(a.rate).toBe(0.5); expect(a.noTieRate).toBe(1);
    expect(a.brier).toBeGreaterThan(0); expect(a.logLoss).toBeGreaterThan(0);
  });
  it('uses only observed two-ahead targets without inserting hypothetical training outcomes', () => {
    const history: Outcome[] = ['B', 'P', 'B', 'B', 'T'];
    const copy = [...history], next = analyzeTwoAhead(history);
    expect(history).toEqual(copy);
    expect(next[0].probabilities.B).toBeCloseTo(BASE.B);
    expect(next[2].sampleSize).toBe(0); expect(next[2].probabilities).toEqual(BASE);
    for (const m of next) expect(Object.values(m.probabilities).reduce((a, b) => a + b)).toBeCloseTo(1);
  });
  it('normalizes all four horizons and picks the highest probability without changing history', () => {
    const history: Outcome[] = ['B','P','B','B','T','P','B','P','P','B'];
    const original = [...history];
    for (const horizon of [1,2,3,4] as const) for (const model of analyze(history, [history], horizon)) {
      expect(Object.values(model.probabilities).reduce((a,b)=>a+b)).toBeCloseTo(1);
      expect(model.probabilities[model.pick]).toBe(Math.max(...Object.values(model.probabilities)));
    }
    expect(history).toEqual(original);
  });
  it('uses confirmed score matches only when three observed targets exist and falls back otherwise', () => {
    const history: Outcome[] = ['B','P','B','P','B','P','B'];
    const scores = [9,4,9,4,9,4,9];
    const model = analyze(history, [history], 1, scores, [scores])[3];
    expect(model.sampleSize).toBe(3); expect(model.basis).toContain('점수 9'); expect(model.pick).toBe('P');
    expect(analyze(history,[history],4,scores,[scores])[3].basis).toContain('3개 미만');
  });
  it('does not carry streaks across an unobserved round', () => {
    const s = statistics(['B', 'B', 'B', 'B'], [], [1, 2, 5, 6]);
    expect(s.current.length).toBe(2); expect(s.longest.B).toBe(2);
  });
  it('compares only identical target rounds and immediate horizons', () => {
    const forecasts = ['A', 'B', 'C', 'D'].map(method => ({ method, shoeId: 's', targetRound: 10, horizon: 1, actual: 'B', mark: 'O', createdAt: '2026-01-01', probabilities: BASE })) as Forecast[];
    const partial = { ...forecasts[0], targetRound: 11, mark: 'X' as const };
    const future = { ...partial, horizon: 2 as const };
    expect(statistics([], [...forecasts, partial, future]).comparisons).toBe(1);
    expect(statistics([], [...forecasts, partial]).accuracy.A.all.count).toBe(1);
  });
});
