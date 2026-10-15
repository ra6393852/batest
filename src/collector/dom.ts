import type { AdapterProfile, Observation, Outcome } from '../shared/types';
export const demoProfile: AdapterProfile = {
  id: 'local-demo-v1', hosts: [], roomSelector: '[data-room-id]', roomIdAttribute: 'data-room-id',
  shoeSelector: '[data-shoe-id]', shoeIdAttribute: 'data-shoe-id', rowSelector: '[data-result-round]',
  roundAttribute: 'data-result-round', outcomeAttribute: 'data-outcome', confidence: 1,
};
export function readDOM(document: Document, profile: AdapterProfile, source: 'dom' | 'demo' = 'dom'): Observation[] {
  const room = document.querySelector(profile.roomSelector), shoe = document.querySelector(profile.shoeSelector);
  const roomId = room?.getAttribute(profile.roomIdAttribute)?.trim(), roomName = room?.textContent?.trim();
  const shoeId = shoe?.getAttribute(profile.shoeIdAttribute)?.trim();
  if (!roomId || !roomName || !shoeId) return [];
  return [...document.querySelectorAll(profile.rowSelector)].slice(-500).flatMap(row => {
    const round = Number(row.getAttribute(profile.roundAttribute));
    const outcome = row.getAttribute(profile.outcomeAttribute)?.trim().toUpperCase();
    if (!Number.isInteger(round) || round < 1 || !['B', 'P', 'T'].includes(outcome ?? '')) return [];
    const occurredAt = profile.occurredAtAttribute ? row.getAttribute(profile.occurredAtAttribute) ?? undefined : undefined;
    return [{ roomId, roomName, shoeId, round, outcome: outcome as Outcome, confidence: profile.confidence,
      source, historical: true, ...(occurredAt ? { occurredAt } : {}) }];
  });
}
// New collector/navigation starts with historical rows. No guessed shoe IDs or inferred round numbers.
export class ObservationTracker {
  private seen = new Map<string, string>();
  private initialized = new Set<string>();
  filter(rows: Observation[]): Observation[] {
    const fresh: Observation[] = [], newContexts = new Set<string>();
    for (const o of rows) {
      const context = JSON.stringify([o.roomId, o.shoeId]), key = JSON.stringify([o.roomId, o.shoeId, o.round]);
      if (!this.initialized.has(context)) newContexts.add(context);
      if (this.seen.get(key) === o.outcome) continue;
      this.seen.set(key, o.outcome);
      fresh.push({ ...o, historical: newContexts.has(context) });
    }
    for (const context of newContexts) this.initialized.add(context);
    return fresh;
  }
}
