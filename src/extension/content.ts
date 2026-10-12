import { readDOM } from '../collector/dom';
import type { AdapterProfile } from '../shared/types';
// Isolated extension world. Only this extension can access this guard; pages receive no API.
const scope = globalThis as typeof globalThis & { baccaratReadOnlyStarted?: boolean };
if (!scope.baccaratReadOnlyStarted) {
  scope.baccaratReadOnlyStarted = true;
  let busy = false;
  const scan = async () => {
    if (busy) return; busy = true;
    try {
      const config: { profile: AdapterProfile | null } = await chrome.runtime.sendMessage({ type: 'config' });
      if (!config?.profile || !config.profile.hosts.includes(location.hostname)) return;
      const observations = readDOM(document, config.profile).map(o => ({ ...o, source: 'chrome' as const, historical: true }));
      await chrome.runtime.sendMessage({ type: 'rows', observations });
    } catch { /* no credentials, URLs, or raw DOM are logged */ }
    finally { busy = false; }
  };
  let timer = setInterval(() => { void scan(); }, 1000); void scan();
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', event => { if (event.persisted) { clearInterval(timer); timer = setInterval(() => { void scan(); }, 1000); void scan(); } });
}
