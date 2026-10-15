import type {Outcome} from '../../src/shared/types';
// Reproduces the visible 43-bead layout and corner pair dots; this is not the
// user's original attachment. Fractional pitch models a scaled browser canvas.
export const visibleOutcomes=('PPBBBP'+'BBPBPB'+'BTPPPB'+'PPPPPB'+'BBBTTP'+'BPPPBB'+'PTBBPP'+'B').split('') as Outcome[];
const digits=['111/101/101/101/111','010/110/010/010/111','111/001/111/100/111','111/001/111/001/111','101/101/111/001/001','111/100/111/001/111','111/100/111/101/111','111/001/010/010/010','111/101/111/101/111','111/101/111/001/111'];
export function numericBeads(sequence=visibleOutcomes,markers=[14,27,37,40],scores?:number[]){
  const width=475,height=116,pitch=17.6,left=5,top=4,bitmap=new Uint8Array(width*height*4).fill(255);
  const set=(x:number,y:number,c:number[])=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<width&&y>=0&&y<height)bitmap.set([...c,255],(y*width+x)*4);};
  for(let r=0;r<=6;r++)for(let x=left;x<=left+26*pitch;x++)set(x,top+r*pitch,[215,215,215]);
  for(let col=0;col<=26;col++)for(let y=top;y<=top+6*pitch;y++)set(left+col*pitch,y,[215,215,215]);
  const circle=(cx:number,cy:number,r:number,c:number[])=>{for(let y=Math.floor(cy-r);y<=cy+r;y++)for(let x=Math.floor(cx-r);x<=cx+r;x++)if((x-cx)**2+(y-cy)**2<=r*r)set(x,y,c);};
  sequence.forEach((o,i)=>{const x=left+(Math.floor(i/6)+.5)*pitch,y=top+(i%6+.5)*pitch;
    circle(x,y,7.8,o==='B'?[35,27,241]:o==='P'?[252,143,36]:[80,156,22]);
    digits[scores?.[i]??i%10].split('/').forEach((row,gy)=>[...row].forEach((p,gx)=>{if(p==='1')for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)set(x-3+gx*2+dx,y-5+gy*2+dy,[255,255,255]);}));
    if(markers.includes(i)){const mx=x+pitch*.25,my=y+pitch*.25;circle(mx,my,3.4,[255,255,255]);circle(mx,my,2.4,o==='B'?[252,143,36]:[35,27,241]);}
  });return {width,height,bitmap};
}
