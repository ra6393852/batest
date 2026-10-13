import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { BeadImageResult } from '../collector/bead-image';
import type { ImageReview, ImageSaveRequest, ImageSaveResult } from '../shared/types';
import type { AnalyzerStore } from './store';
const requestSchema = z.object({
  reviewId: z.uuid(), roomName: z.string().trim().min(1).max(120),
  shoeId: z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} _.:/-]+$/u),
  startRound: z.number().int().min(1).max(999500), outcomes: z.array(z.enum(['B', 'P', 'T'])).min(7).max(500),
}).strict();
export class ImageImport {
  private review: { id: string; count: number; expires: number } | null = null;
  create(analysis: BeadImageResult, preview: string): ImageReview {
    const id = randomUUID(); this.review = { id, count: analysis.outcomes.length, expires: Date.now() + 600000 };
    return { id, outcomes: [...analysis.outcomes], confidence: analysis.confidence, preview, warnings: [...analysis.warnings] };
  }
  save(raw: ImageSaveRequest, store: AnalyzerStore): ImageSaveResult {
    const input = requestSchema.parse(raw);
    if (!this.review || input.reviewId !== this.review.id || Date.now() > this.review.expires || input.outcomes.length !== this.review.count)
      throw new Error('이미지를 다시 읽고 결과를 확인하세요.');
    const roomId = `image:${createHash('sha256').update(input.roomName).digest('hex').slice(0, 24)}`;
    const previous = store.snapshot(roomId, input.shoeId);
    const before = previous.roomId === roomId && previous.shoeId === input.shoeId ? previous.results.length : 0;
    store.ingest(input.outcomes.map((outcome, index) => ({
      roomId, roomName: input.roomName, shoeId: input.shoeId, round: input.startRound + index,
      outcome, confidence: 1, source: 'manual' as const, historical: true,
    })));
    const snapshot = store.snapshot(roomId, input.shoeId);
    this.review = null;
    return { roomId, shoeId: input.shoeId, added: snapshot.results.length - before, pending: snapshot.pending.filter(row => row.roomId === roomId && row.shoeId === input.shoeId).length };
  }
}
