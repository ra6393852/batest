import type { Outcome } from '../../src/shared/types';
export const exampleOutcomes = ('BBBPPB' + 'BTBPPP' + 'BBPPPB' + 'PBPBPT' + 'TBBPPB' + 'BBBPPB' + 'BP').split('') as Outcome[];
const glyphs = { B: ['11110','10001','10001','11110','10001','10001','11110'], P: ['11110','10001','10001','11110','10000','10000','10000'], T: ['11111','00100','00100','00100','00100','00100','00100'] };
export function smallRoadBitmap(kind: 'bead' | 'big-road', touching = false, sequence: Outcome[] = exampleOutcomes) {
  const width = 475, height = 139, bitmap = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, color: number[]) => { if (x >= 0 && y >= 0 && x < width && y < height) bitmap.set([...color, 255], (Math.round(y) * width + Math.round(x)) * 4); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, x >= 4 && x <= 468 && y >= 10 && y <= 122 ? [255,255,255] : [12,16,90]);
  const pitch = kind === 'bead' ? 17.6 : 12, top = kind === 'bead' ? 14 : 4, left = 6;
  const columns = kind === 'bead' ? 26 : 38;
  for (let row = 0; row <= 6; row++) for (let x = left; x <= left + columns * pitch; x++) set(x, Math.round(top + row * pitch), [220,220,220]);
  for (let col = 0; col <= columns; col++) for (let y = top; y <= top + 6 * pitch; y++) set(Math.round(left + col * pitch), y, [220,220,220]);
  const paint = (column: number, row: number, outcome: Outcome, marked: boolean) => {
    const cx = left + (column + 0.5) * pitch, cy = top + (row + 0.5) * pitch;
    const radius = kind === 'bead' ? touching ? 9 : 8 : 5.2;
    const color = outcome === 'B' ? [24,28,245] : outcome === 'P' ? [250,140,20] : [45,180,15];
    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= radius ** 2 && (kind === 'bead' || d >= (radius - 1.4) ** 2)) set(x,y,color);
    }
    if (kind === 'bead') glyphs[outcome].forEach((bits, gy) => [...bits].forEach((bit, gx) => {
      if (bit === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) set(Math.round(cx) - 5 + gx * 2 + dx, Math.round(cy) - 7 + gy * 2 + dy, [255,255,255]);
    }));
    if (marked) for (let offset = -3; offset <= 3; offset++) set(Math.round(cx + offset), Math.round(cy - offset), kind === 'bead' ? [255,255,255] : [20,180,15]);
  };
  if (kind === 'bead') sequence.forEach((outcome, index) => paint(Math.floor(index / 6), index % 6, outcome, index % 5 === 1));
  else {
    let column = -1, row = 0, previous: Outcome | null = null;
    for (let index = 0; index < sequence.length; index++) {
      const outcome = sequence[index]; if (outcome === 'T') continue;
      if (outcome !== previous) { column++; row = 0; } else row++;
      paint(column, row, outcome, sequence[index + 1] === 'T'); previous = outcome;
    }
  }
  return { width, height, bitmap };
}
