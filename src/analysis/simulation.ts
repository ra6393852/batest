import { analyze, statistics } from './engine';
import type { Forecast, Outcome } from '../shared/types';
export function parseSequence(value: string): Outcome[] {
  if (value.length > 7000) throw new Error('최대 500개 결과를 입력하세요.');
  const sequence = value.toUpperCase().replace(/[\s,;|/\-]/g, '');
  if (!/^[BPT]{1,500}$/.test(sequence)) throw new Error('B/P/T만 순서대로 입력하세요. 공백과 쉼표는 사용할 수 있습니다.');
  return [...sequence] as Outcome[];
}
export function simulateHistory(values: Outcome[], warmup = 10) {
  if (warmup < 1 || !Number.isInteger(warmup)) throw new Error('초기 기록 수를 확인하세요.');
  const forecasts: Forecast[] = [];
  for (let cutoff = warmup; cutoff < values.length; cutoff++) {
    const models = analyze(values.slice(0, cutoff));
    for (const model of models) forecasts.push({
      ...model, id: `simulation:${cutoff}:${model.method}`, roomId: 'simulation', shoeId: 'offline',
      targetRound: cutoff + 1, cutoffRound: cutoff, horizon: 1,
      createdAt: new Date(Date.UTC(2000, 0, 1) + cutoff * 1000).toISOString(),
      actual: values[cutoff], mark: model.pick === values[cutoff] ? 'O' : 'X',
    });
  }
  return { forecasts, stats: statistics(values, forecasts), next: analyze(values) };
}
