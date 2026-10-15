import { methods, type Outcome, type Method, type Probabilities, type Forecast, type Accuracy, type RoomStats } from '../shared/types';
export const BASE: Probabilities = { B: 0.4586, P: 0.4462, T: 0.0952 };
export interface Model { method: Method; probabilities: Probabilities; pick: Outcome; sampleSize: number; basis: string }
const tally = (values: Outcome[]) => values.reduce((c, o) => { c[o]++; return c; }, { B: 0, P: 0, T: 0 });
function smooth(values: Outcome[]): Probabilities {
  const c = tally(values), priorWeight = 10;
  return Object.fromEntries(Object.entries(BASE).map(([k, p]) => [k, (c[k as Outcome] + p * priorWeight) / (values.length + priorWeight)])) as Probabilities;
}
export function streak(values: Outcome[]) {
  const nonTie = values.filter(o => o !== 'T');
  const outcome = nonTie.at(-1) ?? null;
  let length = 0;
  for (let i = nonTie.length - 1; i >= 0 && nonTie[i] === outcome; i--) length++;
  return { outcome, length };
}
function patternNext(values: Outcome[], pattern: Outcome[], horizon: number): Outcome[] {
  if (!pattern.length) return [];
  const matches: Outcome[] = [];
  for (let i = pattern.length; i - 1 + horizon < values.length; i++) {
    if (pattern.every((o, j) => values[i - pattern.length + j] === o)) matches.push(values[i - 1 + horizon]);
  }
  return matches;
}
export function analyze(values: Outcome[], corpus: Outcome[][] = [values], horizon: Forecast['horizon'] = 1,
  scores: Array<number | null> = [], scoreCorpus: Array<Array<number | null>> = []): Model[] {
  const recent = values.slice(-20), run = streak(values);
  // C conditions on the exact non-tie run length; ties do not break runs.
  const next: Outcome[] = [];
  for (const segment of corpus) {
    let previous: Outcome | null = null, length = 0;
    for (let i = 0; i < segment.length - horizon; i++) {
      const o = segment[i];
      if (o !== 'T') { length = o === previous ? length + 1 : 1; previous = o; }
      if (previous === run.outcome && length === run.length && run.outcome) next.push(segment[i + horizon]);
    }
  }
  const whole = corpus.flatMap(segment => patternNext(segment, values.slice(-2), horizon));
  const scoreMatches: Outcome[] = [], lastScore = scores.at(-1);
  if (lastScore !== undefined && lastScore !== null) corpus.forEach((segment, index) => {
    for (let i = 0; i + horizon < segment.length; i++)
      if (segment[i] === values.at(-1) && scoreCorpus[index]?.[i] === lastScore) scoreMatches.push(segment[i + horizon]);
  });
  const useScore = scoreMatches.length >= 3;
  const samples: Record<Method, Outcome[]> = { A: [], B: recent, C: next, D: useScore ? scoreMatches : whole };
  const bases: Record<Method, string> = {
    A: '표준 8덱 이론값 · 남은 카드 계산 아님',
    B: '최근 20회 관측 + 이론값 10회 가중 평활',
    C: `현재 연속 길이와 같은 과거 상태의 ${horizon}회 뒤 관측 결과 + 평활`,
    D: useScore ? `같은 승패·표시 점수 ${lastScore}의 ${horizon}회 뒤 관측 결과 + 평활`
      : `해당 방 최근 2개 패턴의 ${horizon}회 뒤 관측 결과 + 평활${lastScore != null ? ' · 점수 일치 표본 3개 미만' : ''}`,
  };
  return methods.map(method => {
    const probabilities = method === 'A' ? { ...BASE } : smooth(samples[method]);
    const pick = (['B', 'P', 'T'] as Outcome[]).reduce((best, o) => probabilities[o] > probabilities[best] ? o : best, 'B');
    return { method, probabilities, pick, sampleSize: samples[method].length, basis: bases[method] };
  });
}
export function analyzeTwoAhead(values: Outcome[], corpus: Outcome[][] = [values]): Model[] {
  return analyze(values, corpus, 2);
}
export function accuracy(forecasts: Forecast[]): Accuracy {
  const scored = forecasts.filter(f => f.actual !== undefined);
  const noTie = scored.filter(f => f.actual !== 'T');
  const correct = scored.filter(f => f.mark === 'O').length, noTieCorrect = noTie.filter(f => f.mark === 'O').length;
  const brier = scored.reduce((sum, f) => sum + (['B', 'P', 'T'] as Outcome[]).reduce((s, o) => s + (f.probabilities[o] - Number(f.actual === o)) ** 2, 0), 0);
  const logLoss = scored.reduce((sum, f) => sum - Math.log(Math.max(1e-15, f.probabilities[f.actual!])), 0);
  return { count: scored.length, correct, rate: scored.length ? correct / scored.length : null,
    noTieCount: noTie.length, noTieCorrect, noTieRate: noTie.length ? noTieCorrect / noTie.length : null,
    brier: scored.length ? brier / scored.length : null, logLoss: scored.length ? logLoss / scored.length : null };
}
export function statistics(values: Outcome[], forecasts: Forecast[], rounds?: number[]): RoomStats {
  const counts = tally(values), total = values.length;
  let previous: Outcome | null = null, run = 0, transitions = 0;
  const longest = { B: 0, P: 0 };
  let tailStart = 0;
  for (const [i, o] of values.entries()) {
    if (rounds && i > 0 && rounds[i] !== rounds[i - 1] + 1) { previous = null; run = 0; tailStart = i; }
    if (o === 'T') continue;
    if (previous && previous !== o) transitions++;
    run = o === previous ? run + 1 : 1; previous = o; longest[o] = Math.max(longest[o], run);
  }
  // Only compare immediate forecasts when all four methods were scored for that round.
  const groups = new Map<string, Forecast[]>();
  for (const f of forecasts.filter(f => f.horizon === 1 && f.actual !== undefined)) {
    const key = `${f.shoeId}:${f.targetRound}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const matched = [...groups.values()].filter(g => methods.every(m => g.some(f => f.method === m))).flat();
  const advanceGroups = new Map<string, Forecast[]>();
  for (const f of forecasts.filter(f => f.actual !== undefined)) {
    const key = `${f.shoeId}:${f.cutoffRound}:${f.targetRound}`;
    advanceGroups.set(key, [...(advanceGroups.get(key) ?? []), f]);
  }
  const advanceMatched = [...advanceGroups.values()].filter(g => methods.every(m => g.some(f => f.method === m))).flat();
  const perMethod = Object.fromEntries(methods.map(m => {
    const all = matched.filter(f => f.method === m).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.targetRound - b.targetRound);
    return [m, { all: accuracy(all), last10: accuracy(all.slice(-10)), last30: accuracy(all.slice(-30)), last100: accuracy(all.slice(-100)) }];
  })) as RoomStats['accuracy'];
  return { total, counts, ratios: { B: total ? counts.B / total : 0, P: total ? counts.P / total : 0, T: total ? counts.T / total : 0 },
    current: streak(values.slice(tailStart)), longest, transitions, comparisons: matched.length / 4, accuracy: perMethod,
    advanceComparisons: advanceMatched.length / 4, advanceAccuracy: Object.fromEntries(methods.map(m => [m, accuracy(advanceMatched.filter(f => f.method === m))])) as RoomStats['advanceAccuracy'] };
}
