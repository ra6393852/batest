// Discovery retains hostnames only. Never return a full launch/session URL.
export function httpsHost(value?: string): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.hostname : null;
  } catch { return null; }
}
export function allowedHost(host: string, origins: string[]): boolean {
  return origins.some(origin => origin === `https://${host}/*` || (host === '127.0.0.1' && origin === 'http://127.0.0.1/*') || origin === 'https://*/*' || origin === '<all_urls>');
}
export function collectorHost(value: string | undefined, loopback: boolean): string | null {
  const host = httpsHost(value); if (host) return host;
  if (!loopback) return null;
  try { const url = new URL(value ?? ''); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password ? url.hostname : null; }
  catch { return null; }
}
export function relatedTabs(tabs: Array<{ id?: number; openerTabId?: number; windowId: number; url?: string }>, origins: string[], popupWindows: Set<number>): number[] {
  const selected = new Set<number>();
  for (const tab of tabs) {
    const host = collectorHost(tab.url, origins.includes('http://127.0.0.1/*'));
    if (tab.id !== undefined && ((host && allowedHost(host, origins)) || popupWindows.has(tab.windowId))) selected.add(tab.id);
  }
  // Follow window.open descendants even when their new domains have not been granted yet.
  for (let pass = 0; pass < tabs.length; pass++) {
    const before = selected.size;
    for (const tab of tabs) if (tab.id !== undefined && tab.openerTabId !== undefined && selected.has(tab.openerTabId)) selected.add(tab.id);
    if (selected.size === before) break;
  }
  return [...selected].slice(0, 30);
}
