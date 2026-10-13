import { describe, expect, it } from 'vitest';
import { readBigRoadGrid, type RoadCell, type RoadGrid } from '../../src/collector/road-grid';
function tail() {
  const cells: RoadCell[][] = Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => ({ outcome: null, banker: 0, player: 0, green: 0, filled: false, marked: false })));
  const set = (x: number, y: number, outcome: 'B' | 'P') => { cells[x][y].outcome = outcome; cells[x][y][outcome === 'B' ? 'banker' : 'player'] = 30; };
  for (let y = 0; y < 6; y++) set(0,y,'B'); set(1,5,'B'); set(2,5,'B');
  for (let y = 0; y < 5; y++) set(1,y,'P'); set(2,4,'P'); set(3,4,'P');
  set(2,0,'B'); set(2,1,'B'); set(3,0,'P');
  return { cells, bounds: { x: 0, y: 0, width: 60, height: 72 } } as RoadGrid;
}
describe('big-road chronology', () => {
  it('follows bottom tails and collision tails before returning to each new run at the top', () => {
    expect(readBigRoadGrid(tail())?.outcomes.join('')).toBe('BBBBBBBBPPPPPPPBBP');
  });
  it('rejects unexplained extra cells instead of discarding results', () => {
    const grid = tail(); grid.cells[4][3].outcome = 'B';
    expect(readBigRoadGrid(grid)).toBeNull();
  });
});
