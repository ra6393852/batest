// Hue bands separate tie-green (including teal highlights) from player-blue.
// Low-chroma digit/white/grey pixels and the ambiguous cyan gap do not vote.
export function beadInk(b:number,g:number,r:number,a=255):0|1|2|3 {
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  if(a<160||max<100||delta<35||delta/max<.2)return 0;
  if(max===r){const h=60*(g-b)/delta;return h>=-25&&h<=30?1:0;}
  if(max===g){const h=120+60*(b-r)/delta;return h>=85&&h<=175?3:0;}
  const h=240+60*(r-g)/delta;return h>=190&&h<=265?2:0;
}
