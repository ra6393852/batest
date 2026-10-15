export interface DigitCell { x: number; y: number; width: number; height: number }
export function digitStrip(width: number, height: number, bitmap: Uint8Array, cells: DigitCell[]) {
  const slot = 64, outputWidth = cells.length * slot, output = new Uint8Array(outputWidth * slot * 4).fill(255);
  cells.forEach((cell, index) => {
    const cx = cell.x + cell.width / 2, cy = cell.y + cell.height / 2, radius = Math.min(cell.width, cell.height) * 0.4;
    const points: Array<[number, number]> = [];
    for (let y = Math.max(0, Math.ceil(cy - radius)); y < Math.min(height, cy + radius); y++) for (let x = Math.max(0, Math.ceil(cx - radius)); x < Math.min(width, cx + radius); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      const p = (y * width + x) * 4, min = Math.min(bitmap[p], bitmap[p + 1], bitmap[p + 2]), max = Math.max(bitmap[p], bitmap[p + 1], bitmap[p + 2]);
      if (bitmap[p + 3] >= 160 && min >= 190 && max - min <= 50) points.push([x, y]);
    }
    if (points.length < 3) return;
    const left = Math.min(...points.map(p => p[0])), top = Math.min(...points.map(p => p[1]));
    const gw = Math.max(...points.map(p => p[0])) - left + 1, gh = Math.max(...points.map(p => p[1])) - top + 1;
    const scale = Math.min(38 / gh, 34 / gw), ox = index * slot + (slot - gw * scale) / 2, oy = (slot - gh * scale) / 2;
    for (const [x, y] of points) for (let py = Math.floor(oy + (y - top) * scale); py < oy + (y - top + 1) * scale; py++) for (let px = Math.floor(ox + (x - left) * scale); px < ox + (x - left + 1) * scale; px++)
      output.set([0, 0, 0, 255], (py * outputWidth + px) * 4);
  });
  return { width: outputWidth, height: slot, bitmap: output, slot };
}
