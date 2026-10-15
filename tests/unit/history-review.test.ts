import {describe,it,expect} from 'vitest';
import {reviewHistory} from '../../src/analysis/history-review';
import {BASE} from '../../src/analysis/engine';
describe('retrospective analysis with target withheld',()=>{
  const rows=[...'BPTPBPPB'].map((outcome,i)=>({round:i+1,outcome:outcome as 'B'|'P'|'T',score:i}));
  it('includes the first round using only the theoretical prior, and compares identical targets',()=>{
    const review=reviewHistory(rows);expect(review.rows.map(r=>r.round)).toEqual([1,2,3,4,5,6,7,8]);
    expect(review.rows[0].priorCount).toBe(0);expect(review.rows[0].models.every(m=>JSON.stringify(m.probabilities)===JSON.stringify(BASE))).toBe(true);
    for(const a of Object.values(review.accuracy))expect(a.count).toBe(8);
  });
  it('never trains on the target outcome, its point, or later rows',()=>{
    const original=reviewHistory(rows);
    const altered=reviewHistory([...rows.slice(0,4),{round:5,outcome:'T',score:9},{round:6,outcome:'B',score:0}]);
    expect(original.rows[4].models.map(({mark,...m})=>m)).toEqual(altered.rows[4].models.map(({mark,...m})=>m));
    expect(original.rows.slice(0,4)).toEqual(altered.rows.slice(0,4));
  });
  it('resets training at missing rounds rather than joining unrelated runs',()=>{
    const review=reviewHistory([rows[0],{round:4,outcome:'P'},{round:5,outcome:'B'}]);
    expect(review.rows.map(r=>r.priorCount)).toEqual([0,0,1]);expect(()=>reviewHistory([rows[1],rows[0]])).toThrow();
  });
});
