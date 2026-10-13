import { nativeImage } from 'electron';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { join } from 'node:path';
import { digitStrip, type DigitCell } from '../collector/digit-bitmap';

export class ScoreReader {
  private worker?: Promise<Worker>;
  constructor(private resources: string | null, private workerPath: string) {}
  async read(width: number, height: number, bitmap: Uint8Array, cells: DigitCell[]) {
    this.worker ??= createWorker('eng', 1, {
      langPath: this.resources ? join(this.resources, 'eng') : join(process.cwd(), 'node_modules/@tesseract.js-data/eng/4.0.0'),
      corePath: this.resources ? join(this.resources, 'node_modules/tesseract.js-core') : undefined,
      workerPath: this.workerPath, gzip: true, cacheMethod: 'none',
    });
    const worker = await this.worker;
    await worker.setParameters({ tessedit_char_whitelist: '0123456789BPT', tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const scores: Array<number | null> = cells.map(() => null), confidences = cells.map(() => 0);
    let glyphs=0, numericGlyphs=0;
    for (let start = 0; start < cells.length; start += 40) {
      const strip = digitStrip(width, height, bitmap, cells.slice(start, start + 40));
      const png = nativeImage.createFromBitmap(Buffer.from(strip.bitmap), { width: strip.width, height: strip.height }).toPNG();
      const { data } = await worker.recognize(png, {}, { blocks: true });
      const symbols = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words.flatMap(word => word.symbols)))) ?? [];
      const candidates = new Map<number, typeof symbols>();
      for (const symbol of symbols) {
        const index = Math.floor((symbol.bbox.x0 + symbol.bbox.x1) / 2 / strip.slot);
        if (index < 0 || start + index >= cells.length || symbol.bbox.x0 < index * strip.slot || symbol.bbox.x1 > (index + 1) * strip.slot) continue;
        candidates.set(index, [...(candidates.get(index) ?? []), symbol]);
      }
      for (const [index, matches] of candidates) {
        if(matches.length===1&&/^[0-9BPT]$/.test(matches[0].text.trim())) {glyphs++;if(/^[0-9]$/.test(matches[0].text.trim())) numericGlyphs++;}
        if (matches.length !== 1 || !/^[0-9]$/.test(matches[0].text.trim())) continue;
        const confidence = matches[0].confidence / 100; confidences[start + index] = confidence;
        if (confidence >= 0.8) scores[start + index] = Number(matches[0].text.trim());
      }
    }
    // Retry uncertain numeric glyphs individually; never force letters or empty
    // cells into digits, and keep the same confidence requirement.
    const numericChart=glyphs>=7&&numericGlyphs/glyphs>=0.75;
    const retry = scores.map((score,index)=>({score,index})).filter(({score,index})=>score===null&&(numericChart||confidences[index]>0)).slice(0,12);
    if (retry.length) await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_CHAR, tessedit_char_whitelist:numericChart?'0123456789':'0123456789BPT' });
    for (const {index} of retry) {
      const strip=digitStrip(width,height,bitmap,[cells[index]]);
      const png=nativeImage.createFromBitmap(Buffer.from(strip.bitmap),{width:strip.width,height:strip.height}).toPNG();
      const {data}=await worker.recognize(png);const text=data.text.trim();
      if (/^[0-9]$/.test(text)&&data.confidence>=80) {scores[index]=Number(text);confidences[index]=data.confidence/100;}
      else {
        // Different OS font rasters can leave a small digit uncertain. Try a
        // larger rendering of the same glyph, keeping the confidence gate.
        const larger=nativeImage.createFromBuffer(png).resize({width:128,quality:'best'}).toPNG();
        const retry=await worker.recognize(larger);const value=retry.data.text.trim();
        if(/^[0-9]$/.test(value)&&retry.data.confidence>=80){scores[index]=Number(value);confidences[index]=retry.data.confidence/100;}
      }
    }
    return { scores, confidences };
  }
  async close() { try { if (this.worker) await (await this.worker).terminate(); } catch { /* Initialization failure is already shown in the review. */ } }
}
