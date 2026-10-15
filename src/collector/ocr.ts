import type { Outcome } from '../shared/types';
// Text OCR is an optional adapter tool. Colored road cells require a separately validated vision adapter.
export function parseOCR(text: string, confidence: number): { outcome: Outcome; confidence: number } | null {
  const cleaned = text.trim().toUpperCase();
  const words: Record<string, Outcome> = { B: 'B', BANKER: 'B', P: 'P', PLAYER: 'P', T: 'T', TIE: 'T' };
  if (!Object.hasOwn(words, cleaned) || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) return null;
  return { outcome: words[cleaned], confidence: confidence / 100 };
}
