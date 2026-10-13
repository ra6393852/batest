export interface TextLine { text: string; confidence: number }
export function counterDigitsConfidence(symbols:Array<{text:string;confidence:number}>):number {
  const glyphs=symbols.filter(s=>s.text.trim());const hash=glyphs.findIndex(s=>s.text.trim()==='#');
  if(hash<0)return 0;
  const digits:Array<{text:string;confidence:number}>=[];
  for(const symbol of glyphs.slice(hash+1)){if(!/^[0-9]$/.test(symbol.text.trim()))break;digits.push(symbol);}
  return digits.length>=1&&digits.length<=3?Math.min(...digits.map(s=>s.confidence)):0;
}
// Accept named table headers only. A lobby containing several tables is ambiguous.
export function roomFromLines(lines: TextLine[]): string | null {
  const rooms=new Set<string>();
  for(const line of lines){
    if(line.confidence<80)continue;
    const text=line.text.replace(/\s+/g,' ').trim();
    const matches=text.matchAll(/(?:(코리안|korean)\s*)?(?:(스피드\s*바카라|speed\s*baccarat)|(바카라|baccarat))\s*([A-Za-z]{1,3}|\d{1,3})(?=\s|$|[₩$€.,])/gi);
    for(const match of matches){
      const speed=Boolean(match[2]), suffix=match[4].toUpperCase();
      if(speed&&!/^[A-Z]{1,3}$/.test(suffix))continue;
      rooms.add(`${match[1]?'코리안 ':''}${speed?'스피드 바카라':'바카라'} ${suffix}`);
    }
  }
  return rooms.size===1?[...rooms][0]:null;
}
export function countFromLines(lines: TextLine[]): number | null {
  const counts=new Set<number>();
  for(const line of lines){
    if(line.confidence<80)continue;
    const match=line.text.match(/(?:#|회차|rounds?\s*:?|total\s*:?|전체\s*:?)[\s]*(\d{1,3})(?![\d:])/i);
    if(match){const count=Number(match[1]);if(count>=0&&count<=500)counts.add(count);}
  }
  return counts.size===1?[...counts][0]:null;
}
