import type { Outcome } from '../shared/types';
export interface RoadCell { outcome: Outcome | null; banker: number; player: number; green: number; filled: boolean; marked: boolean }
export interface RoadGrid { bounds: { x: number; y: number; width: number; height: number }; cells: RoadCell[][] }

// Read the grey grid independently of colored connected components. Adjacent beads,
// white letters, and pair markers must not join/split the underlying result cells.
export function findRoadGrids(width: number, height: number, bitmap: Uint8Array, colors: Uint8Array): RoadGrid[] {
  const histogram = new Uint32Array(256);
  for (let p = 0; p < colors.length; p++) {
    const b = bitmap[p * 4], g = bitmap[p * 4 + 1], r = bitmap[p * 4 + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 10 && Math.min(r, g, b) >= 200) histogram[Math.round((r + g + b) / 3)]++;
  }
  let background = 255; for (let value = 200; value <= 255; value++) if (histogram[value] > histogram[background]) background = value;
  const grey = new Uint8Array(colors.length);
  for (let p = 0; p < colors.length; p++) {
    const b = bitmap[p * 4], g = bitmap[p * 4 + 1], r = bitmap[p * 4 + 2];
    grey[p] = Number(bitmap[p * 4 + 3] >= 160 && Math.min(r, g, b) >= 140 && Math.max(r, g, b) <= background - 3 && Math.max(r, g, b) - Math.min(r, g, b) <= 10);
  }
  const lines: Array<{ y: number; left: number; right: number; count: number }> = [];
  const minimum = Math.min(160, Math.max(48, width * 0.12));
  for (let y = 0; y < height; y++) {
    let start = -1, last = -1, hits = 0, best = { left: 0, right: 0 };
    const finish = () => { if (last - start + 1 >= minimum && hits / (last - start + 1) >= 0.55 && last - start > best.right - best.left) best = { left: start, right: last }; };
    for (let x = 0; x < width; x++) {
      if (grey[y * width + x]) { if (start < 0) start = x; last = x; hits++; }
      else if (start >= 0 && x - last > 6) { finish(); start = -1; hits = 0; }
    }
    if (start >= 0) finish();
    if (best.right - best.left < minimum) continue;
    const previous = lines.at(-1);
    if (previous && y - previous.y <= 2 && Math.min(previous.right, best.right) - Math.max(previous.left, best.left) >= minimum) {
      previous.y = (previous.y * previous.count + y) / (previous.count + 1); previous.count++;
      previous.left = Math.min(previous.left, best.left); previous.right = Math.max(previous.right, best.right);
    } else lines.push({ y, ...best, count: 1 });
  }
  // Outer chart borders may be white/gold rather than grey. Find five evenly
  // spaced interior dividers, allowing unrelated watermark strokes between them,
  // and recover the two boundaries only when the full six rows fit the image.
  const bands: Array<typeof lines> = [];
  for (let first = 0; first + 6 < lines.length; first++) bands.push(lines.slice(first, first + 7));
  const inferred = new Set<string>();
  for (let first = 0; first < lines.length; first++) {
    for (let second = first + 1; second < Math.min(lines.length, first + 7); second++) {
      const dy = lines[second].y - lines[first].y;
      if (dy < 7 || dy > 128) continue;
      const tolerance = Math.max(1.5, dy * 0.09), interior = [lines[first], lines[second]];
      let previous = second;
      for (let row = 2; row < 5; row++) {
        const goal = lines[first].y + row * dy;
        let found = -1, distance = Infinity;
        for (let index = previous + 1; index < lines.length && lines[index].y <= goal + tolerance; index++) {
          const delta = Math.abs(lines[index].y - goal);
          if (delta <= tolerance && delta < distance) { found = index; distance = delta; }
        }
        if (found < 0) break;
        interior.push(lines[found]); previous = found;
      }
      if (interior.length !== 5) continue;
      const top = interior[0].y - dy, bottom = interior[4].y + dy;
      if (top < 0 || bottom >= height) continue;
      const key = `${Math.round(top)}:${Math.round(bottom)}`;
      if (inferred.has(key)) continue;
      // Require matching line spans. Text alone must not invent a chart.
      const left = Math.max(...interior.map(line => line.left)), right = Math.min(...interior.map(line => line.right));
      if (right - left < minimum) continue;
      // Recovered first/last rows must lie on the bright chart surface.
      const brightRow = (y: number) => {
        let bright = 0, samples = 0;
        for (let x = left; x <= right; x += 2) {
          const p = Math.round(y) * width + x;
          if (bitmap[p * 4 + 3] >= 160 && Math.max(bitmap[p * 4], bitmap[p * 4 + 1], bitmap[p * 4 + 2]) >= 200) bright++;
          samples++;
        }
        return samples && bright / samples >= 0.8;
      };
      if (!brightRow(top + dy * 0.5) || !brightRow(bottom - dy * 0.5)) continue;
      inferred.add(key);
      bands.push([{ y: top, left, right, count: 0 }, ...interior, { y: bottom, left, right, count: 0 }]);
    }
  }
  const grids: RoadGrid[] = [];
  for (const band of bands) {
    if (grids.length >= 30) break;
    const dy = (band[6].y - band[0].y) / 6;
    if (dy < 7 || dy > 128 || band.some((line, row) => Math.abs(line.y - band[0].y - row * dy) > Math.max(1.5, dy * 0.09))) continue;
    const prior = [...lines].reverse().find(line => line.y < band[0].y - 2);
    if (prior && Math.abs(band[0].y - prior.y - dy) < Math.max(1.5, dy * 0.09) && Math.min(prior.right, band[0].right) - Math.max(prior.left, band[0].left) > Math.min(prior.right - prior.left, band[0].right - band[0].left) * 0.8) continue;
    const top = Math.round(band[0].y), bottom = Math.round(band[6].y), end = Math.min(width - 1, Math.ceil(Math.max(...band.map(line => line.right))));
    const xLines: number[] = [];
    let run: number[] = [];
    const flush = () => { if (run.length) { xLines.push(run.reduce((a, b) => a + b, 0) / run.length); run = []; } };
    for (let x = 0; x <= end; x++) {
      let count = 0, samples = 0;
      for (let y = top + 2; y < bottom - 1; y++) {
        if (band.some(line => Math.abs(y - line.y) < 1.5)) continue;
        samples++; count += grey[y * width + x];
      }
      if (samples && count / samples >= 0.45) run.push(x); else flush();
    }
    flush();
    let chain: number[] = [];
    const readChain = () => {
      if (chain.length < 3 || chain.length > 100) return;
      const dx = (chain.at(-1)! - chain[0]) / (chain.length - 1);
      if (chain.some((x, i) => Math.abs(x - chain[0] - i * dx) > Math.max(1.5, dx * 0.1))) return;
      // A white/gold vertical border must not cause the first/last result column
      // to be discarded. Recover an adjacent cell only from visible colored ink
      // on the chart surface; reject a result column cut by the image edge.
      const hasEdgeResult = (left: number, right: number) => {
        let hasInk = false, bright = 0, area = 0;
        for (let row = 0; row < 6; row++) {
          let ink = 0, rowArea = 0;
          const y0 = Math.round(band[0].y + row * dy), y1 = Math.round(band[0].y + (row + 1) * dy);
          for (let y = y0 + 1; y < y1; y++) for (let x = Math.max(0, Math.round(left) + 1); x < Math.min(width, Math.round(right)); x++) {
            const p = y * width + x, b = bitmap[p * 4], g = bitmap[p * 4 + 1], r = bitmap[p * 4 + 2];
            ink += Number(colors[p] !== 0); rowArea++; area++;
            if (bitmap[p * 4 + 3] >= 160 && Math.min(r, g, b) >= 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 10) bright++;
          }
          if (ink >= Math.max(3, rowArea * 0.055)) hasInk = true;
        }
        return hasInk && area > 0 && bright / area >= 0.25;
      };
      if (hasEdgeResult(chain[0] - dx, chain[0])) {
        if (chain[0] - dx < 0) return;
        chain = [chain[0] - dx, ...chain];
      }
      if (hasEdgeResult(chain.at(-1)!, chain.at(-1)! + dx)) {
        if (chain.at(-1)! + dx >= width) return;
        chain = [...chain, chain.at(-1)! + dx];
      }
      const cells: RoadCell[][] = [];
      for (let column = 0; column + 1 < chain.length; column++) {
        const rows: RoadCell[] = [];
        for (let row = 0; row < 6; row++) {
          const x0 = Math.round(chain[0] + column * dx), x1 = Math.round(chain[0] + (column + 1) * dx);
          const y0 = Math.round(band[0].y + row * dy), y1 = Math.round(band[0].y + (row + 1) * dy);
          const counts = [0, 0, 0, 0], inner = [0, 0, 0, 0], core = [0, 0, 0, 0]; let area = 0, innerArea = 0, coreArea = 0;
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
            const color = colors[y * width + x]; counts[color]++; area++;
            if ((x - cx) ** 2 + (y - cy) ** 2 <= (Math.min(dx, dy) * 0.37) ** 2) { inner[color]++; innerArea++; }
            if ((x - cx) ** 2 + (y - cy) ** 2 <= (Math.min(dx, dy) * 0.2) ** 2) { core[color]++; coreArea++; }
          }
          const winner = counts[1] >= counts[2] && counts[1] >= counts[3] ? 1 : counts[2] >= counts[3] ? 2 : 3;
          const filled = counts[winner] / area >= 0.28 && inner[winner] / Math.max(1, innerArea) >= 0.22 && core[winner] / Math.max(1, coreArea) >= 0.12;
          const bp = counts[1] >= counts[2] ? 1 : 2;
          rows.push({ outcome: filled ? (['B', 'P', 'T'] as const)[winner - 1] : counts[bp] / area >= 0.055 ? bp === 1 ? 'B' : 'P' : null,
            banker: counts[1], player: counts[2], green: counts[3], filled, marked: counts[3] >= Math.max(2, area * 0.025) });
        }
        cells.push(rows);
      }
      grids.push({ bounds: { x: Math.max(0, Math.floor(chain[0])), y: top, width: Math.min(width, Math.ceil(chain.at(-1)!)) - Math.floor(chain[0]), height: bottom - top }, cells });
    };
    for (const x of xLines) {
      const previous = chain.at(-1);
      if (previous !== undefined && Math.abs(x - previous - dy) > Math.max(1.5, dy * 0.18)) { readChain(); chain = []; }
      chain.push(x);
    }
    readChain();
  }
  return grids;
}

export function readBeadGrid(grid: RoadGrid, minimum = 7): Outcome[] | null {
  const columns = grid.cells.map(column => column.map(cell => cell.filled ? cell.outcome : null));
  const first = columns.findIndex(column => column.some(Boolean)); if (first < 0) return null;
  const result: Outcome[] = []; let ended = false;
  for (const column of columns.slice(first)) {
    for (const cell of column) {
      if (!cell) ended = true;
      else if (ended) return null;
      else result.push(cell);
    }
  }
  return result.length >= minimum && result.length <= 500 ? result : null;
}

export function readBigRoadGrid(grid: RoadGrid): { outcomes: Outcome[]; tieAfter: number[] } | null {
  const cells = grid.cells, count = cells.flat().filter(cell => cell.outcome === 'B' || cell.outcome === 'P').length;
  if (count < 7 || count > 500 || cells.flat().filter(cell => cell.filled).length > count * 0.3) return null;
  const first = cells.findIndex(column => column[0].outcome === 'B' || column[0].outcome === 'P'); if (first < 0) return null;
  const used = new Set<string>(), outcomes: Outcome[] = [], tieAfter: number[] = [];
  let start = first, x = first, y = 0, bent = false;
  const cell = (column: number, row: number) => cells[column]?.[row];
  while (outcomes.length < count) {
    const current = cell(x, y); if (!current || (current.outcome !== 'B' && current.outcome !== 'P') || used.has(`${x}:${y}`)) return null;
    used.add(`${x}:${y}`); outcomes.push(current.outcome); if (current.marked) tieAfter.push(outcomes.length - 1);
    const below = cell(x, y + 1), right = cell(x + 1, y);
    if (!bent && below?.outcome === current.outcome && !used.has(`${x}:${y + 1}`)) { y++; continue; }
    const blocked = y === 5 || used.has(`${x}:${y + 1}`);
    if ((bent || blocked) && right?.outcome === current.outcome && !used.has(`${x + 1}:${y}`)) { x++; bent = true; continue; }
    start++; while (used.has(`${start}:0`)) start++;
    const next = cell(start, 0);
    if (!next?.outcome) break;
    if (next.outcome === current.outcome || next.outcome === 'T') return null;
    x = start; y = 0; bent = false;
  }
  return outcomes.length === count ? { outcomes, tieAfter } : null;
}
