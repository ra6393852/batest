import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { BeadImageResult } from '../collector/bead-image';
import type { ImageReview, ImageSaveRequest, ImageSaveResult, Outcome } from '../shared/types';
import type { AnalyzerStore } from './store';
const requestSchema = z.object({
  reviewId: z.uuid(), roomName: z.string().trim().min(1).max(120),
  shoeId: z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} _.:/-]+$/u),
  startRound: z.number().int().min(1).max(999500), outcomes: z.array(z.enum(['B', 'P', 'T'])).min(1).max(500),
  tiesAfter: z.array(z.object({ index: z.number().int().min(0).max(499), count: z.number().int().min(1).max(20) }).strict()).max(500).optional(),
}).strict();
export class ImageImport {
  private review: { id: string; count: number; expires: number; format: 'bead' | 'big-road'; tieAfter: number[] } | null = null;
  create(analysis: BeadImageResult, preview: string): ImageReview {
    const id = randomUUID(); this.review = { id, count: analysis.outcomes.length, expires: Date.now() + 600000, format: analysis.format, tieAfter: [...analysis.tieAfter] };
    return { id, outcomes: [...analysis.outcomes], confidence: analysis.confidence, preview, warnings: [...analysis.warnings], format: analysis.format, tieAfter: [...analysis.tieAfter] };
  }
  save(raw: ImageSaveRequest, store: AnalyzerStore): ImageSaveResult {
    const input = requestSchema.parse(raw);
    if (!this.review || input.reviewId !== this.review.id || Date.now() > this.review.expires || input.outcomes.length !== this.review.count)
      throw new Error('이미지를 다시 읽고 결과를 확인하세요.');
    const ties = new Map<number, number>();
    for (const tie of input.tiesAfter ?? []) {
      if (this.review.format !== 'big-road' || tie.index >= input.outcomes.length || ties.has(tie.index)) throw new Error('타이 횟수를 확인하세요.');
      ties.set(tie.index, tie.count);
    }
    if (this.review.tieAfter.some(index => !ties.has(index))) throw new Error('초록 타이 표시의 횟수를 모두 확인하세요.');
    const outcomes = input.outcomes.flatMap((outcome, index) => [outcome, ...Array<Outcome>(ties.get(index) ?? 0).fill('T')]);
    if (outcomes.length > 500) throw new Error('한 번에 최대 500개 기록을 저장할 수 있습니다.');
    const roomId = `image:${createHash('sha256').update(input.roomName).digest('hex').slice(0, 24)}`;
    const previous = store.snapshot(roomId, input.shoeId);
    const before = previous.roomId === roomId && previous.shoeId === input.shoeId ? previous.results.length : 0;
    store.ingest(outcomes.map((outcome, index) => ({
      roomId, roomName: input.roomName, shoeId: input.shoeId, round: input.startRound + index,
      outcome, confidence: 1, source: 'manual' as const, historical: true,
    })));
    const snapshot = store.snapshot(roomId, input.shoeId);
    this.review = null;
    return { roomId, shoeId: input.shoeId, added: snapshot.results.length - before, pending: snapshot.pending.filter(row => row.roomId === roomId && row.shoeId === input.shoeId).length };
  }
}
