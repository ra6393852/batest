// Exact 2× pixels preserve bead colors and thin grey grid lines. Enlarging does
// not invent detail or override confidence checks on a blurred source image.
export function doubleBitmap(width:number,height:number,bitmap:Uint8Array){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height*4>12_000_000||bitmap.length!==width*height*4)throw new Error('2배 판독 이미지 크기를 확인하세요.');
  const aligned=bitmap.byteOffset%4===0?bitmap:bitmap.slice();
  const source=new Uint32Array(aligned.buffer,aligned.byteOffset,width*height),output=new Uint32Array(width*height*4),w=width*2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const value=source[y*width+x],p=y*2*w+x*2;
    output[p]=value;output[p+1]=value;output[p+w]=value;output[p+w+1]=value;
  }
  return {width:w,height:height*2,bitmap:new Uint8Array(output.buffer)};
}
