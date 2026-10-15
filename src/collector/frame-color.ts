import type { Outcome } from '../shared/types';
import type { DigitCell } from './digit-bitmap';
import {beadInk} from './ink-color';

// Ink agreement is a spatial check, not an OCR probability. White digits are
// excluded. Small, separate opposite-color corner components are pair dots;
// a conflicting main fill must still fail the normal 92% agreement gate.
export function assessBeadColors(width: number, bitmap: Uint8Array, cells: DigitCell[], outcomes: Outcome[]) {
  return cells.map((cell, index) => {
    const counts = { B: 0, P: 0, T: 0 }, cx = cell.x + cell.width / 2, cy = cell.y + cell.height / 2;
    const radius = Math.min(cell.width, cell.height) * 0.38;
    const left=Math.max(0,Math.floor(cx-radius)),top=Math.max(0,Math.floor(cy-radius));
    const right=Math.min(width,Math.ceil(cx+radius)),bottom=Math.min(bitmap.length/4/width,Math.ceil(cy+radius));
    const w=right-left,h=bottom-top,colors=new Uint8Array(Math.max(0,w*h)),visited=new Uint8Array(colors.length);
    const names=['B','P','T'] as const;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      if ((x-cx)**2+(y-cy)**2 > radius**2) continue;
      const p = (y*width+x)*4, b=bitmap[p],g=bitmap[p+1],r=bitmap[p+2];
      if(bitmap[p+3]<160)continue;
      const color=beadInk(b,g,r,bitmap[p+3]);
      colors[(y-top)*w+x-left]=color;if(color)counts[names[color-1]]++;
    }
    let ignoredMarkerPixels=0;
    for(let p=0;p<colors.length;p++){
      const color=colors[p];if(!color||visited[p]||names[color-1]===outcomes[index])continue;
      const queue=[p];visited[p]=1;let sx=0,sy=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(let q=0;q<queue.length;q++){const pos=queue[q],x=pos%w,y=Math.floor(pos/w);sx+=left+x;sy+=top+y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const next=ny*w+nx;if(!visited[next]&&colors[next]===color){visited[next]=1;queue.push(next);}}
      }
      const size=Math.min(cell.width,cell.height),dx=Math.abs(sx/queue.length-cx),dy=Math.abs(sy/queue.length-cy);
      if(queue.length<=size*size*.055&&maxX-minX+1<=size*.3&&maxY-minY+1<=size*.3&&dx>=size*.16&&dy>=size*.16&&Math.hypot(dx,dy)>=size*.25&&counts[outcomes[index]]>=queue.length*2){
        counts[names[color-1]]-=queue.length;ignoredMarkerPixels+=queue.length;
      }
    }
    const total=counts.B+counts.P+counts.T;
    const dominant=total?names.reduce((a,b)=>counts[a]>=counts[b]?a:b):undefined;
    return {confidence:total>=Math.max(5,radius*radius*.3)?counts[outcomes[index]]/total:0,dominant,ignoredMarkerPixels};
  });
}
export function beadColorConfidence(width:number,bitmap:Uint8Array,cells:DigitCell[],outcomes:Outcome[]){return assessBeadColors(width,bitmap,cells,outcomes).map(c=>c.confidence);}
