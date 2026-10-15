import { describe, expect, it } from 'vitest';
import { expandImageSequence } from '../../src/shared/image-sequence';
import { shortTieSequence } from '../fixtures/circle-road-bitmap';

describe('review and storage use the same tie chronology', () => {
  const bp = shortTieSequence.filter(outcome => outcome !== 'T');
  it('places the marked tie at round 13 and preserves all 15 rounds', () => {
    const entries = expandImageSequence(bp, new Map([[11, 1]]));
    expect(entries.map(entry => entry.outcome)).toEqual(shortTieSequence);
    expect(entries[12]).toEqual({ outcome: 'T', sourceIndex: 11, tieOffset: 1 });
    expect(entries[13]).toEqual({ outcome: 'P', sourceIndex: 12, tieOffset: 0 });
    expect(entries).toHaveLength(15);
  });
  it('expands repeated ties and keeps source indices stable for corrections', () => {
    const entries = expandImageSequence(bp, new Map([[11, 2]]));
    expect(entries).toHaveLength(16);
    expect(entries.slice(12, 14).map(entry => entry.outcome)).toEqual(['T', 'T']);
    expect(entries[14]).toEqual({ outcome: 'P', sourceIndex: 12, tieOffset: 0 });
  });
});
