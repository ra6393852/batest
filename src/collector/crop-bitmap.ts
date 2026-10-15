export interface PixelRect {x:number;y:number;width:number;height:number}
export function cropBitmap(width:number,height:number,bitmap:Uint8Array,rect:PixelRect){
  if(bitmap.length!==width*height*4||![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>width||rect.y+rect.height>height)throw new Error('그림판 범위가 이미지 밖입니다.');
  const out=new Uint8Array(rect.width*rect.height*4);
  for(let y=0;y<rect.height;y++){const p=((rect.y+y)*width+rect.x)*4;out.set(bitmap.subarray(p,p+rect.width*4),y*rect.width*4);}
  return out;
}
