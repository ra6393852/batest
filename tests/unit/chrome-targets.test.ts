import { describe, expect, it } from 'vitest';
import { allowedHost, httpsHost, relatedTabs } from '../../src/extension/targets';
describe('Chrome game window discovery', () => {
  it('retains only an HTTPS hostname, never a session link or URL credentials', () => {
    expect(httpsHost('https://game.example/launch?session=private#secret')).toBe('game.example');
    expect(httpsHost('https://user:password@game.example/')).toBeNull(); expect(httpsHost('chrome://settings')).toBeNull();
  });
  it('follows a new unpermitted game window and its descendants without inspecting unrelated normal tabs', () => {
    const tabs = [
      { id: 1, windowId: 10, url: 'https://box-1515.com/lobby' },
      { id: 2, windowId: 11, openerTabId: 1 }, { id: 3, windowId: 12, openerTabId: 2 },
      { id: 4, windowId: 13 }, { id: 5, windowId: 14, url: 'https://unrelated.example' },
    ];
    expect(relatedTabs(tabs, ['https://box-1515.com/*'], new Set([13]))).toEqual([1, 4, 2, 3]);
  });
  it('does not extend a site permission to a different provider domain', () => {
    expect(allowedHost('game.example', ['https://box-1515.com/*'])).toBe(false);
    expect(allowedHost('game.example', ['https://game.example/*'])).toBe(true);
  });
});
