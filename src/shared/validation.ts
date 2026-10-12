import { z } from 'zod';
const id = z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} _.:/-]+$/u);
export const observationSchema = z.object({
  roomId: id, roomName: z.string().trim().min(1).max(120), shoeId: id,
  round: z.number().int().min(1).max(1_000_000), outcome: z.enum(['B', 'P', 'T']),
  confidence: z.number().min(0).max(1), source: z.enum(['dom', 'ocr', 'demo', 'manual']),
  historical: z.boolean(), occurredAt: z.iso.datetime().optional(),
}).strict();
const selector = z.string().min(1).max(200);
const attribute = z.string().regex(/^data-[a-z0-9-]+$/);
export const profileSchema = z.object({
  id, hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1).max(10),
  roomSelector: selector, roomIdAttribute: attribute,
  shoeSelector: selector, shoeIdAttribute: attribute,
  rowSelector: selector, roundAttribute: attribute, outcomeAttribute: attribute,
  occurredAtAttribute: attribute.optional(), confidence: z.number().min(0).max(1),
  ocr: z.object({ imageSelector: selector, roundSelector: selector, roundAttribute: attribute }).strict().optional(),
}).strict();
export const observationsSchema = z.array(observationSchema).max(500);
