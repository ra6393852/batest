import type { Outcome } from '../shared/types';
import { findRoadGrids, readBeadGrid, readBigRoadGrid } from './road-grid';
export interface BeadImageResult {
  outcomes: Outcome[]; confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  warnings: string[];
  format: 'bead' | 'big-road'; tieAfter: number[];
}
type Dot = { x: number; y: number; width: number; height: number; outcome: Outcome; fill: number };
// Electron's nativeImage.toBitmap() is BGRA. No files, network, or page interaction here.
export function analyzeBeadBitmap(width: number, height: number, bitmap: Uint8Array): BeadImageResult {
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels > 12_000_000 || bitmap.length !== pixels * 4)
    throw new Error('이미지는 최대 1,200만 픽셀까지 읽을 수 있습니다.');
  const colors = new Uint8Array(pixels), visited = new Uint8Array(pixels), queue = new Int32Array(pixels);
  for (let p = 0; p < pixels; p++) {
    const b = bitmap[p * 4], g = bitmap[p * 4 + 1], r = bitmap[p * 4 + 2];
    if (bitmap[p * 4 + 3] < 160) continue;
    if (r >= 140 && r > g * 1.35 && r > b * 1.35) colors[p] = 1;
    else if (b >= 140 && b > r * 1.3 && b >= g * 0.9) colors[p] = 2;
    else if (g >= 100 && g > r * 1.25 && g > b * 1.15) colors[p] = 3;
  }
  const grids = findRoadGrids(width, height, bitmap, colors);
  const readings: Array<{ bounds: BeadImageResult['bounds']; outcomes: Outcome[]; tieAfter: number[]; format: 'bead' | 'big-road' }> = [];
  for (const grid of grids) {
    const bead = readBeadGrid(grid);
    if (bead) { readings.push({ ...grid, outcomes: bead, tieAfter: [], format: 'bead' }); continue; }
    const road = readBigRoadGrid(grid);
    if (road) readings.push({ ...grid, ...road, format: 'big-road' });
  }
  readings.sort((a, b) => b.outcomes.length - a.outcomes.length);
  if (readings.length) {
    const reading = readings[0];
    if (readings.some(other => other !== reading && other.outcomes.length >= reading.outcomes.length * 0.8 && (other.bounds.x >= reading.bounds.x + reading.bounds.width || reading.bounds.x >= other.bounds.x + other.bounds.width || other.bounds.y >= reading.bounds.y + reading.bounds.height || reading.bounds.y >= other.bounds.y + other.bounds.height)))
      throw new Error('여러 그림판이 비슷하게 보여 하나를 정할 수 없습니다. 분석할 그림판만 포함한 이미지를 넣어주세요.');
    return { outcomes: reading.outcomes, format: reading.format, tieAfter: reading.tieAfter, bounds: reading.bounds, confidence: 0.8,
      warnings: reading.format === 'bead' ? ['비드로드 격자를 위→아래 6행, 왼쪽 열부터 읽었습니다. 빨강 B·파랑 P·초록 T의 순서를 원본과 확인하세요.', '방·슈·실제 회차 번호는 이미지에서 자동 확인하지 않습니다. 과거 기록으로 저장하며 사후 O/X 채점하지 않습니다.']
        : ['빅로드의 B/P 연속과 꺾임을 따라 읽었습니다. 아래 파생 로드는 결과 기록에 포함하지 않습니다.', '초록 타이 표시의 횟수는 자동 확정하지 않습니다. 원본의 숫자/표시를 확인해 각 타이 횟수를 입력하세요.', '방·슈·실제 회차 번호를 확인하세요. 과거 기록으로 저장하며 사후 O/X 채점하지 않습니다.'] };
  }
  if (grids.some(grid => grid.cells.flat().filter(cell => cell.outcome !== null).length >= 7))
    throw new Error('격자는 찾았지만 일부 결과 또는 순서가 불확실합니다. 원본을 확인하거나 B/P/T 직접 입력으로 시작하세요.');
  const dots: Dot[] = [], outcomes: Outcome[] = ['B', 'P', 'T'];
  for (let start = 0; start < pixels; start++) {
    if (!colors[start] || visited[start]) continue;
    const color = colors[start]; let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const add = (next: number) => { if (!visited[next] && colors[next] === color) { visited[next] = 1; queue[tail++] = next; } };
      if (x > 0) add(p - 1); if (x + 1 < width) add(p + 1); if (y > 0) add(p - width); if (y + 1 < height) add(p + width);
    }
    const w = maxX - minX + 1, h = maxY - minY + 1, fill = tail / (w * h);
    if (w < 5 || h < 5 || w > 128 || h > 128 || w / h < 0.75 || w / h > 1.33 || fill < 0.42 || fill > 0.88) continue;
    dots.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: w, height: h, outcome: outcomes[color - 1], fill });
    if (dots.length > 3000) throw new Error('색상 요소가 너무 많습니다. B/P/T 비드로드만 포함한 이미지를 넣어주세요.');
  }
  const candidates: Array<{ cells: Dot[]; dx: number; dy: number }> = [];
  for (const anchor of dots) {
    const size = (anchor.width + anchor.height) / 2, tolerance = Math.max(1.5, size * 0.22);
    const compatible = dots.filter(d => Math.abs(d.width - anchor.width) < size * 0.28 && Math.abs(d.height - anchor.height) < size * 0.28);
    const below = compatible.filter(d => Math.abs(d.x - anchor.x) < tolerance && d.y - anchor.y >= size * 0.8 && d.y - anchor.y < size * 2.5).sort((a, b) => a.y - b.y)[0];
    const right = compatible.filter(d => Math.abs(d.y - anchor.y) < tolerance && d.x - anchor.x >= size * 0.8 && d.x - anchor.x < size * 2.5).sort((a, b) => a.x - b.x)[0];
    if (!below || !right) continue;
    const dx = right.x - anchor.x, dy = below.y - anchor.y;
    if (Math.abs(dx - dy) > Math.max(dx, dy) * 0.2) continue;
    // Do not quietly accept a suffix of a board whose earlier column has a gap.
    if (compatible.some(d => Math.abs(d.x - (anchor.x - dx)) < tolerance && Array.from({ length: 6 }, (_, row) => anchor.y + row * dy).some(y => Math.abs(d.y - y) < tolerance))) continue;
    const grid = new Map<string, Dot>(); let duplicate = false;
    for (const dot of compatible) {
      const column = Math.round((dot.x - anchor.x) / dx), row = Math.round((dot.y - anchor.y) / dy);
      if (column < 0 || column >= 84 || row < 0 || row >= 6 || Math.abs(dot.x - (anchor.x + column * dx)) >= tolerance || Math.abs(dot.y - (anchor.y + row * dy)) >= tolerance) continue;
      const key = `${column}:${row}`; if (grid.has(key)) duplicate = true; grid.set(key, dot);
    }
    const at = (column: number, row: number) => grid.get(`${column}:${row}`);
    if (duplicate || Array.from({ length: 6 }, (_, row) => at(0, row)).some(dot => !dot)) continue;
    const cells: Dot[] = []; let invalid = false, finished = false;
    for (let column = 0; column < 84 && !finished; column++) {
      let missing = false;
      for (let row = 0; row < 6; row++) {
        const dot = at(column, row);
        if (!dot) missing = true;
        else if (missing) { invalid = true; break; }
        else cells.push(dot);
      }
      if (invalid) break;
      if (missing) {
        // A gap followed by another column is not a complete chronological bead road.
        for (const key of grid.keys()) if (Number(key.split(':')[0]) > column) invalid = true;
        finished = true;
      }
    }
    if (!invalid && cells.length >= 7 && cells.length <= 500 && cells.slice(0, 6).every((d, row) => Math.abs(d.y - (anchor.y + row * dy)) < tolerance)) candidates.push({ cells, dx, dy });
  }
  candidates.sort((a, b) => b.cells.length - a.cells.length);
  const chosen = candidates[0];
  if (!chosen) throw new Error('그림판 격자와 결과를 찾지 못했습니다. 비드로드 또는 빅로드 원본 영역을 선명하게 캡처해 넣어주세요.');
  const independent = candidates.find(candidate => candidate.cells.length >= chosen.cells.length * 0.8 && candidate.cells.filter(dot => chosen.cells.includes(dot)).length < candidate.cells.length * 0.5);
  if (independent) throw new Error('여러 비드로드가 비슷하게 보여 하나를 정할 수 없습니다. 분석할 비드로드만 포함한 이미지를 넣어주세요.');
  const left = Math.max(0, Math.floor(Math.min(...chosen.cells.map(d => d.x - d.width / 2))));
  const top = Math.max(0, Math.floor(Math.min(...chosen.cells.map(d => d.y - d.height / 2))));
  const right = Math.min(width, Math.ceil(Math.max(...chosen.cells.map(d => d.x + d.width / 2))));
  const bottom = Math.min(height, Math.ceil(Math.max(...chosen.cells.map(d => d.y + d.height / 2))));
  return {
    outcomes: chosen.cells.map(d => d.outcome), confidence: 0.8, format: 'bead', tieAfter: [],
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    warnings: ['색상 기반 인식 추정입니다. 빨강=B, 파랑=P, 초록=T인지 원본과 순서를 확인하세요.', '위에서 아래로 6개씩, 왼쪽 열부터 읽습니다. 방·슈·실제 회차 번호는 이미지에서 자동 확인하지 않습니다.', '이 이미지는 과거 기록으로 저장합니다. 실제 결과 발생 전 예측으로 소급 채점하지 않습니다.'],
  };
}
