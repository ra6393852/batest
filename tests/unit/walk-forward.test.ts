import { describe, it, expect } from 'vitest';
import { analyze, BASE, accuracy } from '../../src/analysis/engine';
import type { Forecast, Outcome } from '../../src/shared/types';
describe('forward-only probability evaluation', () => {
  it('freezes all four distributions before revealing each target on a held-out sequence', () => {
    const outcomes: Outcome[] = ['B', 'P', 'B', 'T', 'B', 'P', 'P', 'T', 'B', 'P', 'B', 'B', 'B', 'P', 'T', 'P', 'B', 'P', 'B', 'T'];
    const forecasts: Forecast[] = [];
    for (let i = 5; i < outcomes.length; i++) {
      const models = analyze(outcomes.slice(0, i));
      const frozen = structuredClone(models);
      const actual = outcomes[i];
      for (const m of models) forecasts.push({ id: `${i}:${m.method}`, roomId: 'r', shoeId: 's', targetRound: i + 1, cutoffRound: i,
        horizon: 1, method: m.method, probabilities: m.probabilities, pick: m.pick, sampleSize: m.sampleSize, basis: m.basis,
        createdAt: new Date(i * 1000).toISOString(), actual, mark: m.pick === actual ? 'O' : 'X' });
      expect(models).toEqual(frozen);
      expect(models[0].probabilities).toEqual(BASE);
    }
    for (const method of ['A', 'B', 'C', 'D']) {
      const a = accuracy(forecasts.filter(f => f.method === method)); expect(a.count).toBe(15);
      expect(a.brier).toBeGreaterThanOrEqual(0); expect(a.brier).toBeLessThanOrEqual(2);
      expect(a.logLoss).toBeGreaterThan(0);
    }
    // This test verifies evaluation integrity, not predictive superiority on real games.
  });
});
