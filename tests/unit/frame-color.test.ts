import {test,expect} from 'vitest';
import {numericBeads,visibleOutcomes} from '../fixtures/numeric-beads';
import {analyzeBeadBitmap} from '../../src/collector/bead-image';
import {doubleBitmap} from '../../src/collector/double-bitmap';
import {beadColorConfidence} from '../../src/collector/frame-color';
import type {Outcome} from '../../src/shared/types';
import {beadInk} from '../../src/collector/ink-color';
test('hue bands keep score glyphs neutral and separate teal ties from blue winners',()=>{
  expect(beadInk(152,168,25)).toBe(3);expect(beadInk(250,140,20)).toBe(2);expect(beadInk(30,20,240)).toBe(1);
  expect(beadInk(240,245,242)).toBe(0);expect(beadInk(150,150,20)).toBe(0);
  const width=40,bitmap=new Uint8Array(width*width*4).fill(255),cell={x:0,y:0,width,height:width};
  for(let y=3;y<37;y++)for(let x=3;x<37;x++)if((x-20)**2+(y-20)**2<17**2)bitmap.set(x<20?[92,155,0,255]:[250,140,20,255],(y*width+x)*4);
  expect(beadColorConfidence(width,bitmap,[cell],['T'])[0]).toBeLessThan(.92);
});
test('green numeric bead shading is not counted as player-blue ink',()=>{
  const outcomes=('PBTTPB'+'BPPBBB'+'BPPTPB'+'PTBBBP'+'PPBBPB').split('') as Outcome[];
  const scores=[7,7,8,7,7,2,4,9,9,7,4,9,2,7,7,6,9,8,5,7,5,8,9,8,9,6,5,9,8,9];
  const raw=numericBeads(outcomes,[],scores);
  for(let y=39;y<57;y++)for(let x=5;x<23;x++){const p=(y*raw.width+x)*4;if(raw.bitmap[p+1]>raw.bitmap[p]&&raw.bitmap[p+1]>raw.bitmap[p+2]&&(x+y*2)%8===0)raw.bitmap.set([152,168,25,255],p);}
  const image=doubleBitmap(raw.width,raw.height,raw.bitmap),analysis=analyzeBeadBitmap(image.width,image.height,image.bitmap,true);
  expect(analysis.outcomes).toEqual(outcomes);
  expect(beadColorConfidence(image.width,image.bitmap,analysis.beadCells!,analysis.outcomes)[2]).toBeGreaterThanOrEqual(.92);
});
test('33-bead screenshot layout with repeated blue digits, green ties and corner dots remains readable',()=>{
  const outcomes=('PBPPPT'+'PPBPPP'+'PPBBPT'+'BPBBBB'+'PBBPBT'+'BBP').split('') as Outcome[];
  const scores=[8,4,8,8,9,4,6,7,4,9,5,5,6,9,9,4,7,7,8,7,5,8,3,9,7,9,4,4,8,8,9,8,9];
  const raw=numericBeads(outcomes,[3,4,12,16,32],scores),image=doubleBitmap(raw.width,raw.height,raw.bitmap);
  const analysis=analyzeBeadBitmap(image.width,image.height,image.bitmap,true);
  expect(analysis.outcomes).toEqual(outcomes);expect(analysis.outcomes).toHaveLength(33);
  expect(Math.min(...beadColorConfidence(image.width,image.bitmap,analysis.beadCells!,analysis.outcomes))).toBeGreaterThanOrEqual(.92);
});
test('numeric bead fills remain certain when small opposite-colored pair dots enter the center mask',()=>{
  const raw=numericBeads(),image=doubleBitmap(raw.width,raw.height,raw.bitmap);
  const analysis=analyzeBeadBitmap(image.width,image.height,image.bitmap,true);
  expect(analysis.outcomes).toEqual(visibleOutcomes);
  expect(Math.min(...beadColorConfidence(image.width,image.bitmap,analysis.beadCells!,analysis.outcomes))).toBeGreaterThanOrEqual(.92);
});
test('a genuinely split main fill and absent colored ink remain uncertain',()=>{
  const width=40,bitmap=new Uint8Array(width*width*4).fill(255),cell={x:0,y:0,width,height:width};
  for(let y=3;y<37;y++)for(let x=3;x<37;x++)if((x-20)**2+(y-20)**2<17**2)bitmap.set(x<20?[30,20,240,255]:[250,140,20,255],(y*width+x)*4);
  expect(beadColorConfidence(width,bitmap,[cell],['B'])[0]).toBeLessThan(.92);
  expect(beadColorConfidence(width,new Uint8Array(width*width*4).fill(255),[cell],['P'])[0]).toBe(0);
});
