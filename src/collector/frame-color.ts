import type { Outcome } from '../shared/types';
import type { DigitCell } from './digit-bitmap';

// Confidence is measured from colored pixels near the bead's center, excluding
// its white digit and pair markers in the corners. It is not an OCR probability.
export function beadColorConfidence(width: number, bitmap: Uint8Array, cells: DigitCell[], outcomes: Outcome[]) {
  return cells.map((cell, index) => {
    const counts = { B: 0, P: 0, T: 0 }, cx = cell.x + cell.width / 2, cy = cell.y + cell.height / 2;
    const radius = Math.min(cell.width, cell.height) * 0.38;
    for (let y = Math.max(0, Math.floor(cy-radius)); y < cy+radius; y++) for (let x = Math.max(0, Math.floor(cx-radius)); x < cx+radius; x++) {
      if ((x-cx)**2+(y-cy)**2 > radius**2) continue;
      const p = (y*width+x)*4, b=bitmap[p],g=bitmap[p+1],r=bitmap[p+2];
      if(bitmap[p+3]<160)continue;
      if(r>=140&&r>g*1.35&&r>b*1.35)counts.B++;
      else if(b>=140&&b>r*1.3&&b>=g*0.9)counts.P++;
      else if(g>=100&&g>r*1.25&&g>b*1.15)counts.T++;
    }
    const total=counts.B+counts.P+counts.T;
    return total >= Math.max(5,radius*radius*0.3) ? counts[outcomes[index]]/total : 0;
  });
}
