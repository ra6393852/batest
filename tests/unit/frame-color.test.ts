import {test,expect} from 'vitest';
import {numericBeads,visibleOutcomes} from '../fixtures/numeric-beads';
import {analyzeBeadBitmap} from '../../src/collector/bead-image';
import {doubleBitmap} from '../../src/collector/double-bitmap';
import {beadColorConfidence} from '../../src/collector/frame-color';
import type {Outcome} from '../../src/shared/types';
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
