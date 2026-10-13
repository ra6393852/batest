import type { Outcome } from './types';

export interface ImageSequenceEntry { outcome: Outcome; sourceIndex: number; tieOffset: number }
// Big-road circles contain B/P only. A tie occurs after its marked circle and
// must consume its own chronological round in both the review and saved data.
export function expandImageSequence(outcomes: readonly Outcome[], ties: ReadonlyMap<number, number>): ImageSequenceEntry[] {
  return outcomes.flatMap((outcome, sourceIndex) => [
    { outcome, sourceIndex, tieOffset: 0 },
    ...Array.from({ length: ties.get(sourceIndex) ?? 0 }, (_, offset) => ({ outcome: 'T' as const, sourceIndex, tieOffset: offset + 1 })),
  ]);
}
