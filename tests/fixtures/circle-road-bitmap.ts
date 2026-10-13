import type { Outcome } from '../../src/shared/types';
export const circleSequence = 'BPPBBBBBBBBTPPPPPPPTTBBPBPBPBPPBPPPBPBPBPBP'.split('') as Outcome[];
export const shortTieSequence = 'BBPPPBBPBPPPTPP'.split('') as Outcome[];
export function shortTieRoadBitmap() {
  const source = circleRoadBitmap(shortTieSequence), width = 261, height = 116;
  const bitmap = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) bitmap.set(source.bitmap.slice(y * source.width * 4, (y * source.width + width) * 4), y * width * 4);
  return { width, height, bitmap };
}

// Screenshot-like fractional centers, thin antialiased outlines, green slashes,
// pair dots and faint dividers. This is generated test data, not a user capture.
export function circleRoadBitmap(sequence: Outcome[] = circleSequence, pitch = 18.6, grid = false) {
  const left = 3, top = 3, width = Math.ceil(left + 26 * pitch) + 3, height = Math.ceil(top + 6 * pitch) + 3;
  const bitmap = new Uint8Array(width * height * 4).fill(255);
  const radius = pitch * 0.39, stroke = Math.max(1.3, pitch * 0.1);
  const blend = (x: number, y: number, color: number[], coverage: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height || coverage <= 0) return;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) bitmap[offset + channel] = Math.round(bitmap[offset + channel] * (1 - coverage) + color[channel] * coverage);
  };
  if (grid) {
    for (let y = top; y <= top + 6 * pitch; y++) for (let x = left; x <= left + 26 * pitch; x++) {
      if (Math.abs((x - left) / pitch - Math.round((x - left) / pitch)) * pitch < 0.45 || Math.abs((y - top) / pitch - Math.round((y - top) / pitch)) * pitch < 0.45) blend(x, y, [253,253,253], 1);
    }
  }
  const occupied = new Set<string>(), centers: Array<{ x: number; y: number; outcome: Outcome; marked: boolean }> = [];
  let start = -1, x = 0, y = 0, bent = false, previous: Outcome | null = null;
  sequence.forEach((outcome, index) => {
    if (outcome === 'T') return;
    if (outcome !== previous) { start++; while (occupied.has(`${start}:0`)) start++; x = start; y = 0; bent = false; }
    else if (!bent && y < 5 && !occupied.has(`${x}:${y + 1}`)) y++;
    else { x++; bent = true; }
    occupied.add(`${x}:${y}`);
    const cx = left + (x + 0.5) * pitch, cy = top + (y + 0.5) * pitch, marked = sequence[index + 1] === 'T';
    centers.push({ x: cx, y: cy, outcome, marked });
    const color = outcome === 'B' ? [40,30,255] : [255,140,30];
    for (let py = Math.floor(cy - radius - stroke); py <= cy + radius + stroke; py++) for (let px = Math.floor(cx - radius - stroke); px <= cx + radius + stroke; px++) {
      const distance = Math.hypot(px - cx, py - cy);
      blend(px, py, color, Math.max(0, Math.min(1, stroke / 2 + 0.5 - Math.abs(distance - radius))));
    }
    if (marked) for (let py = Math.floor(cy - radius); py <= cy + radius; py++) for (let px = Math.floor(cx - radius); px <= cx + radius; px++) {
      if (Math.abs(px - cx + py - cy) < 1.8 && Math.hypot(px - cx, py - cy) < radius + 0.4) blend(px, py, [95,170,0], 1);
    }
    if (index % 7 === 4) {
      const px = Math.round(cx + radius * 0.7), py = Math.round(cy + radius * 0.7);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) blend(px + ox, py + oy, outcome === 'B' ? [255,140,30] : [40,30,255], 1);
    }
    previous = outcome;
  });
  // Faint grey watermark strokes crossing the bottom row (no colored pixels).
  for (let x = Math.floor(width * 0.55); x < width * 0.8; x++) blend(x, Math.round(top + pitch * 5.3), [225,225,225], 0.3);
  return { width, height, bitmap, centers };
}
