import {analyze,accuracy,type Model} from './engine';
import {methods,type GameResult,type Forecast,type Accuracy,type Method,type Outcome} from '../shared/types';
export interface HistoryRow {round:number;actual:Outcome;priorCount:number;models:Array<Model&{mark:'O'|'X'}>}
export interface HistoryReview {rows:HistoryRow[];accuracy:Record<Method,Accuracy>}
// Retrospective walk-forward evaluation. Never writes forecasts/settlements or
// invents a pre-result timestamp. Each target and all later scores are withheld.
export function reviewHistory(results:Array<Pick<GameResult,'round'|'outcome'|'score'>>):HistoryReview {
  const rows:HistoryRow[]=[],scored:Forecast[]=[],prefix:Outcome[]=[],scores:Array<number|null>=[];
  let previous=0;
  for(const result of results){
    if(!Number.isInteger(result.round)||result.round<=previous)throw new Error('회차 순서를 확인하세요.');
    if(result.round!==previous+1){prefix.length=0;scores.length=0;}
    const models=analyze(prefix,[prefix],1,scores,[scores]).map(model=>({...model,mark:model.pick===result.outcome?'O' as const:'X' as const}));
    rows.push({round:result.round,actual:result.outcome,priorCount:prefix.length,models});
    for(const model of models)scored.push({...model,id:`review:${result.round}:${model.method}`,roomId:'review',shoeId:'review',
      targetRound:result.round,cutoffRound:result.round-1,horizon:1,createdAt:'',actual:result.outcome});
    prefix.push(result.outcome);scores.push(result.score??null);previous=result.round;
  }
  return {rows,accuracy:Object.fromEntries(methods.map(method=>[method,accuracy(scored.filter(f=>f.method===method))])) as Record<Method,Accuracy>};
}
