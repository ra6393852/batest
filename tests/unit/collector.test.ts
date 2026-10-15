import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { demoProfile, ObservationTracker, readDOM } from '../../src/collector/dom';
import { parseOCR } from '../../src/collector/ocr';
import { navigationAllowed } from '../../src/main/browser-policy';
import { profileSchema } from '../../src/shared/validation';
function document(rows = '<div data-result-round="1" data-outcome="B">B</div>') {
  return new JSDOM(`<h1 data-room-id="r">Room</h1><b data-shoe-id="s">s</b>${rows}`).window.document;
}
describe('read-only automatic collection', () => {
  it('automatically reads explicit room, shoe, round and result markers without a manual region', () => {
    const rows = readDOM(document(), demoProfile, 'demo'); expect(rows[0]).toMatchObject({ roomId: 'r', shoeId: 's', round: 1, outcome: 'B', historical: true });
  });
  it('does not guess missing identities or invalid outcomes', () => {
    const doc = document('<div data-result-round="2" data-outcome="bet">ignored</div>'); expect(readDOM(doc, demoProfile)).toHaveLength(0);
    doc.querySelector('[data-shoe-id]')?.remove(); expect(readDOM(doc, demoProfile)).toHaveLength(0);
  });
  it('classifies first sight as history and new rows as live, suppressing duplicates', () => {
    const tracker = new ObservationTracker(), doc = document();
    expect(tracker.filter(readDOM(doc, demoProfile))[0].historical).toBe(true);
    expect(tracker.filter(readDOM(doc, demoProfile))).toHaveLength(0);
    const row = doc.createElement('div'); row.setAttribute('data-result-round', '2'); row.setAttribute('data-outcome', 'P'); doc.body.append(row);
    expect(tracker.filter(readDOM(doc, demoProfile))[0]).toMatchObject({ round: 2, historical: false });
    row.setAttribute('data-outcome', 'T'); expect(tracker.filter(readDOM(doc, demoProfile))[0].outcome).toBe('T');
  });
  it('separates new rooms and new shoes and recognizes their first batch as history', () => {
    const tracker = new ObservationTracker(), first = readDOM(document(), demoProfile)[0];
    tracker.filter([first]); expect(tracker.filter([{ ...first, roomId: 'other' }])[0].historical).toBe(true);
    expect(tracker.filter([{ ...first, shoeId: 'new' }])[0].historical).toBe(true);
  });
  it('accepts only an unambiguous OCR result and retains confidence', () => {
    expect(parseOCR('Banker\n', 80)).toEqual({ outcome: 'B', confidence: 0.8 });
    expect(parseOCR('B P T', 99)).toBeNull(); expect(parseOCR('Balance', 99)).toBeNull();
    expect(parseOCR('P', 101)).toBeNull(); expect(parseOCR('P', NaN)).toBeNull();
  });
  it('rejects dangerous protocols, credential-bearing URLs, lookalike hosts, and unlisted providers', () => {
    expect(navigationAllowed('https://box-1515.com/lobby', ['box-1515.com'])).toBe(true);
    for (const url of ['http://box-1515.com', 'file:///tmp/test', 'javascript:alert(1)', 'https://box-1515.com.evil.com', 'https://user:pass@box-1515.com', 'https://box-1515.com:1234', 'https://provider.example'])
      expect(navigationAllowed(url, ['box-1515.com'])).toBe(false);
  });
  it('rejects profiles that could carry code or secret data', () => {
    expect(() => profileSchema.parse({ ...demoProfile, hosts: ['box-1515.com'], script: 'fetch(document.cookie)' })).toThrow();
    expect(() => profileSchema.parse({ ...demoProfile, hosts: ['box-1515.com'], roomIdAttribute: 'password' })).toThrow();
  });
});
