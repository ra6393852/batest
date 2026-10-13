import type { Outcome } from '../shared/types';
import type { RoadCell, RoadGrid } from './road-grid';

type Circle = { x: number; y: number; radius: number };
export interface CircleRoadDetection { grids: RoadGrid[]; circles: number; rejected: string[] }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const angles = Array.from({ length: 24 }, (_, i) => [Math.cos(i * Math.PI / 12), Math.sin(i * Math.PI / 12)]);

// A ring's circumference supplies the evidence; grey dividers are not required.
// Sample a narrow annulus so green slashes and small pair dots cannot change B/P.
function ringAt(width: number, height: number, colors: Uint8Array, x: number, y: number, radius: number) {
  const sectors = [0, 0, 0, 0]; let covered = 0;
  const band = Math.max(0.8, radius * 0.17);
  for (const [cos, sin] of angles) {
    const hits = [0, 0, 0, 0];
    for (const dr of [-band, 0, band]) {
      const px = Math.round(x + (radius + dr) * cos), py = Math.round(y + (radius + dr) * sin);
      if (px >= 0 && px < width && py >= 0 && py < height) hits[colors[py * width + px]]++;
    }
    if (hits[1] || hits[2] || hits[3]) covered++;
    for (let color = 1; color <= 3; color++) if (hits[color]) sectors[color]++;
  }
  const winner = sectors[1] >= sectors[2] && sectors[1] >= sectors[3] ? 1 : sectors[2] >= sectors[3] ? 2 : 3;
  let core = 0, area = 0;
  for (let py = Math.ceil(y - radius * 0.4); py <= y + radius * 0.4; py++) for (let px = Math.ceil(x - radius * 0.4); px <= x + radius * 0.4; px++) {
    if (px < 0 || px >= width || py < 0 || py >= height || (px - x) ** 2 + (py - y) ** 2 > (radius * 0.4) ** 2) continue;
    area++; if (colors[py * width + px] === winner) core++;
  }
  const valid = covered >= 19 && sectors[winner] >= 16 && core / Math.max(1, area) < 0.3;
  return { valid, score: covered + sectors[winner], outcome: (['B', 'P', 'T'] as Outcome[])[winner - 1] };
}

export function findCircleRoads(width: number, height: number, bitmap: Uint8Array, colors: Uint8Array): CircleRoadDetection {
  const visited = new Uint8Array(colors.length), queue = new Int32Array(colors.length), circles: Circle[] = [];
  // Union all three colors with eight-neighbor connectivity. A green tie slash
  // often splits a red/blue ring into two same-color components.
  for (let start = 0; start < colors.length; start++) {
    if (!colors[start] || visited[start]) continue;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const next = p + dy * width + dx;
        if (colors[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1, size = Math.min(w, h);
    if (size < 7 || Math.max(w, h) > 128 || w / h < 0.7 || w / h > 1.43 || tail / (w * h) > 0.75) continue;
    let best: (Circle & { score: number }) | undefined;
    const shift = Math.max(0.5, size * 0.07);
    for (const ox of [-shift, 0, shift]) for (const oy of [-shift, 0, shift]) {
      const x = (minX + maxX) / 2 + ox, y = (minY + maxY) / 2 + oy;
      for (let radius = size * 0.34; radius <= size * 0.53; radius += Math.max(0.4, size * 0.035)) {
        const ring = ringAt(width, height, colors, x, y, radius);
        const score = ring.score - 0.15 * (Math.abs(ox) + Math.abs(oy)) - 0.15 * Math.abs(radius - (size - 1) * 0.44);
        if (ring.valid && (!best || score > best.score)) best = { x, y, radius, score };
      }
    }
    if (best) circles.push(best);
    if (circles.length > 1200) return { grids: [], circles: circles.length, rejected: ['분석 영역에 원이 너무 많습니다. 그림판 하나만 포함해 주세요.'] };
  }
  // Split independent charts by neighboring centers and similar circle sizes.
  const parent = circles.map((_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
    const a = circles[i], b = circles[j], radius = (a.radius + b.radius) / 2;
    if (Math.abs(a.radius - b.radius) > Math.max(1, radius * 0.25)) continue;
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), distance = Math.max(dx, dy);
    if (Math.min(dx, dy) <= Math.max(1.5, radius * 0.3) && distance >= radius * 1.8 && distance <= radius * 3.5) parent[root(j)] = root(i);
  }
  const groups = new Map<number, Circle[]>();
  circles.forEach((circle, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), circle]); });
  const grids: RoadGrid[] = [], rejected = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 7) continue;
    const radius = median(group.map(circle => circle.radius)), tolerance = Math.max(1.5, radius * 0.32);
    const horizontal: number[] = [], vertical: number[] = [];
    for (const a of group) {
      const right = group.filter(b => Math.abs(b.y - a.y) <= tolerance && b.x - a.x >= radius * 1.8).sort((a, b) => a.x - b.x)[0];
      const below = group.filter(b => Math.abs(b.x - a.x) <= tolerance && b.y - a.y >= radius * 1.8).sort((a, b) => a.y - b.y)[0];
      if (right && right.x - a.x <= radius * 3.5) horizontal.push(right.x - a.x);
      if (below && below.y - a.y <= radius * 3.5) vertical.push(below.y - a.y);
    }
    if (!horizontal.length) continue;
    let dx = median(horizontal), dy = vertical.length ? median(vertical) : dx;
    if (Math.abs(dx - dy) > Math.max(dx, dy) * 0.12) { rejected.add('원의 가로·세로 간격이 일정하지 않습니다.'); continue; }
    let x0 = Math.min(...group.map(c => c.x)), y0 = Math.min(...group.map(c => c.y));
    // Fit fractional pitch across the whole chart instead of accumulating the
    // rounding error of a single 18/19-pixel neighbor distance.
    const fit = (axis: 'x' | 'y', origin: number, pitch: number) => {
      const indices = group.map(c => Math.round((c[axis] - origin) / pitch));
      const meanI = indices.reduce((sum, value) => sum + value, 0) / indices.length;
      const meanC = group.reduce((sum, c) => sum + c[axis], 0) / group.length;
      const variance = indices.reduce((sum, value) => sum + (value - meanI) ** 2, 0);
      const step = variance ? group.reduce((sum, c, i) => sum + (indices[i] - meanI) * (c[axis] - meanC), 0) / variance : pitch;
      return { pitch: step, origin: meanC - meanI * step, indices };
    };
    const xf = fit('x', x0, dx), yf = fit('y', y0, dy); dx = xf.pitch; dy = yf.pitch; x0 = xf.origin; y0 = yf.origin;
    const columns = Math.max(...xf.indices) + 1;
    if (columns > 100 || yf.indices.some(row => row >= 6) || group.some((c, i) => Math.abs(c.x - x0 - xf.indices[i] * dx) > tolerance || Math.abs(c.y - y0 - yf.indices[i] * dy) > tolerance)) { rejected.add('원 위치를 6행 격자에 맞출 수 없습니다.'); continue; }
    const left = x0 - dx / 2, top = y0 - dy / 2, right = left + columns * dx, bottom = top + 6 * dy;
    if (left < -0.75 || top < -0.75 || right > width + 0.75 || bottom > height + 0.75) { rejected.add('6행 영역 또는 끝 열이 이미지 바깥으로 잘렸습니다.'); continue; }
    const cells: RoadCell[][] = []; let uncertain = false;
    const unreadable: string[] = [];
    const countCell = (column: number, row: number) => {
      const counts = [0, 0, 0, 0]; let bright = 0, area = 0;
      const cx = x0 + column * dx, cy = y0 + row * dy;
      for (let y = Math.max(0, Math.ceil(cy - dy * 0.45)); y < Math.min(height, cy + dy * 0.45); y++) for (let x = Math.max(0, Math.ceil(cx - dx * 0.45)); x < Math.min(width, cx + dx * 0.45); x++) {
        const p = y * width + x; counts[colors[p]]++; area++;
        if (Math.min(bitmap[p * 4], bitmap[p * 4 + 1], bitmap[p * 4 + 2]) >= 200) bright++;
      }
      return { counts, bright: bright / Math.max(1, area), surface: (bright + counts[1] + counts[2] + counts[3]) / Math.max(1, area) };
    };
    for (let column = 0; column < columns; column++) {
      const rows: RoadCell[] = [];
      for (let row = 0; row < 6; row++) {
        const { counts, surface } = countCell(column, row), ink = counts[1] + counts[2] + counts[3];
        // Recheck every lattice position, recovering separated arcs while
        // rejecting unreadable colored cells rather than saving a shorter prefix.
        const ring = ringAt(width, height, colors, x0 + column * dx, y0 + row * dy, radius);
        if (surface < 0.75 || (!ring.valid && ink >= Math.max(8, radius * 1.5))) { uncertain = true; unreadable.push(`${column + 1}열 ${row + 1}행`); }
        rows.push({ outcome: ring.valid ? ring.outcome : null, banker: counts[1], player: counts[2], green: counts[3], filled: false, marked: ring.valid && counts[3] >= Math.max(2, radius * 0.8) });
      }
      cells.push(rows);
    }
    // Visible ink in an adjacent column must not be silently left out, including
    // a partially captured last circle which could not seed a component.
    for (const column of [-1, columns]) for (let row = 0; row < 6; row++) {
      const { counts, bright } = countCell(column, row);
      if (bright >= 0.45 && counts[1] + counts[2] + counts[3] >= Math.max(8, radius * 1.5)) uncertain = true;
    }
    if (uncertain) { rejected.add(`일부 칸의 원 전체를 확인할 수 없습니다${unreadable.length ? ` (${unreadable.slice(0, 3).join(', ')})` : ' (끝 열)'}. 누락 방지를 위해 저장을 멈췄습니다.`); continue; }
    grids.push({ bounds: { x: Math.max(0, Math.floor(left)), y: Math.max(0, Math.floor(top)), width: Math.min(width, Math.ceil(right)) - Math.max(0, Math.floor(left)), height: Math.min(height, Math.ceil(bottom)) - Math.max(0, Math.floor(top)) }, cells });
  }
  return { grids, circles: circles.length, rejected: [...rejected] };
}
