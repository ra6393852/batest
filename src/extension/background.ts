import { profileSchema, observationsSchema } from '../shared/validation';
import type { AdapterProfile, ChromeGameTarget } from '../shared/types';
import { httpsHost, allowedHost, relatedTabs } from './targets';
let socket: WebSocket | null = null, profile: AdapterProfile | null = null, authenticated = false;
let connecting = false, pairingCode: string | null = null;
let status = '프로그램 실행 대기', latestError = '';
let messageSequence = 0;
let origins: string[] = [], scriptUpdate = Promise.resolve();
type Frame = { tabId: number; frameId: number; host: string; kind: 'window' | 'frame'; count?: number; scannedAt?: number };
const discovered = new Map<string, Frame>(), scanned = new Map<string, Frame>();
const frameKey = (tabId: number, frameId: number) => `${tabId}:${frameId}`;
const BRIDGE_URL = 'ws://127.0.0.1:38741/bridge';
const send = (message: unknown) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
async function grantedOrigins() {
  return (await chrome.permissions.getAll()).origins?.filter(o => o.startsWith('https://')) ?? [];
}
function targets(): ChromeGameTarget[] {
  const combined = new Map(discovered);
  for (const [key, frame] of scanned) if (Date.now() - (frame.scannedAt ?? 0) < 15000) combined.set(key, frame);
  const grouped = new Map<string, ChromeGameTarget>();
  for (const frame of combined.values()) {
    const permission = allowedHost(frame.host, origins);
    const configured = Boolean(profile?.hosts.includes(frame.host));
    const recognition = !configured ? 'unconfigured' : frame.count === undefined ? 'waiting' : frame.count ? 'observed' : 'unmatched';
    const key = `${frame.kind}:${frame.host}`;
    const previous = grouped.get(key);
    if (previous?.recognition === 'observed' && recognition !== 'observed') continue;
    grouped.set(key, { host: frame.host, kind: frame.kind, permission, recognition });
  }
  return [...grouped.values()].slice(0, 50);
}
async function discover() {
  origins = await grantedOrigins();
  if (!await chrome.permissions.contains({ permissions: ['webNavigation'] })) return;
  const [tabs, windows] = await Promise.all([chrome.tabs.query({}), chrome.windows.getAll()]);
  const ids = relatedTabs(tabs, origins, new Set(windows.filter(w => w.type === 'popup' && w.id !== undefined).map(w => w.id!)));
  const results = await Promise.allSettled(ids.map(async tabId => ({ tabId, frames: await chrome.webNavigation.getAllFrames({ tabId }) ?? [] })));
  discovered.clear();
  for (const result of results) if (result.status === 'fulfilled') {
    for (const frame of result.value.frames.slice(0, 200)) {
      const host = httpsHost(frame.url); if (!host) continue;
      const item: Frame = { tabId: result.value.tabId, frameId: frame.frameId, host, kind: frame.frameId === 0 ? 'window' : 'frame' };
      discovered.set(frameKey(item.tabId, item.frameId), item);
    }
  }
}
function configureScripts() {
  // Permission changes and bridge reconnects can arrive together. Serialize registration.
  scriptUpdate = scriptUpdate.catch(() => {}).then(async () => {
  origins = await grantedOrigins();
  await chrome.scripting.unregisterContentScripts({ ids: ['baccarat-readonly'] }).catch(() => {});
  if (!origins.length) return;
  await chrome.scripting.registerContentScripts([{
    id: 'baccarat-readonly', matches: origins, js: ['content.js'], allFrames: true,
    persistAcrossSessions: true, runAt: 'document_idle',
  }]);
  // Also attach to a game that was opened before the app/extension.
  const tabs = await chrome.tabs.query({ url: origins });
  for (const tab of tabs) if (tab.id !== undefined) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] }).catch(() => {});
  }
  // A permitted game iframe can live under a different, unpermitted top-level domain.
  await discover();
  for (const frame of discovered.values()) if (allowedHost(frame.host, origins)) {
    await chrome.scripting.executeScript({ target: { tabId: frame.tabId, frameIds: [frame.frameId] }, files: ['content.js'] }).catch(() => {});
  }
  });
  return scriptUpdate;
}
async function presence() {
  if (!authenticated) return;
  origins = await grantedOrigins();
  const tabs = origins.length ? await chrome.tabs.query({ url: origins }) : [];
  send({ type: 'presence', tabs: tabs.length, targets: targets() });
}
async function connect() {
  if (connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  const stored = await chrome.storage.local.get('bridgeToken');
  if (!stored.bridgeToken && !pairingCode) { status = '앱의 연결 코드를 처음 한 번 입력하세요'; return; }
  connecting = true;
  const peer = new WebSocket(BRIDGE_URL); socket = peer;
  peer.onopen = () => {
    send(pairingCode ? { type: 'pair', code: pairingCode } : { type: 'auth', token: stored.bridgeToken });
  };
  peer.onmessage = async event => {
    if (socket !== peer) return;
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === 'paired' && typeof message.token === 'string' && /^[a-f0-9]{64}$/.test(message.token)) {
        await chrome.storage.local.set({ bridgeToken: message.token }); pairingCode = null;
      } else if (message.type === 'ready') {
        profile = message.profile === null ? null : profileSchema.parse(message.profile);
        for (const frame of scanned.values()) frame.count = undefined;
        authenticated = true; status = profile ? '프로그램 연결됨 · 결과 수집 대기' : '프로그램 연결됨 · 실제 결과 인식 프로필 미설정'; latestError = '';
        messageSequence++;
        await configureScripts(); await presence();
      } else if (message.type === 'error') latestError = '앱에서 결과 형식 또는 저장 상태 확인 필요';
      else if (message.type === 'open-panel') await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    } catch { latestError = '연결 정보 형식을 확인하세요'; }
  };
  peer.onerror = () => { latestError = '프로그램이 실행 중인지 확인하세요'; };
  peer.onclose = event => {
    if (socket !== peer) return;
    socket = null; authenticated = false; profile = null; connecting = false;
    status = event.code === 1008 ? '연결 코드 또는 재연결 인증을 확인하세요' : '프로그램 실행 대기 · 자동 재연결';
    pairingCode = null;
  };
  connecting = false;
}
chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  // The same extension UI may be opened as a popup or an ordinary Chrome tab.
  // Origin, rather than the presence of sender.tab, identifies our privileged UI.
  const ui = Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
  if (raw?.type === 'state' && ui) {
    reply({ status, error: latestError, connected: authenticated, profileHosts: profile?.hosts ?? [], targets: targets() }); return;
  }
  if (raw?.type === 'pair' && ui && typeof raw.code === 'string' && /^\d{6}$/.test(raw.code)) {
    pairingCode = raw.code; socket?.close(); socket = null; connecting = false;
    void connect(); reply({ ok: true }); return;
  }
  if ((raw?.type === 'grant' || raw?.type === 'discover') && ui) {
    void (raw.type === 'grant' ? configureScripts() : discover()).then(presence).then(() => reply({ ok: true })).catch(() => reply({ ok: false })); return true;
  }
  if (raw?.type === 'config' && sender.tab) {
    let host = ''; try { host = new URL(sender.url ?? '').hostname; } catch { /* no page URLs in logs */ }
    if (authenticated && sender.tab.id !== undefined && httpsHost(sender.url)) {
      const frameId = sender.frameId ?? 0, key = frameKey(sender.tab.id, frameId), previous = scanned.get(key);
      scanned.set(key, { tabId: sender.tab.id, frameId, host, kind: frameId === 0 ? 'window' : 'frame', count: previous?.count, scannedAt: Date.now() });
    }
    reply({ profile: authenticated && profile?.hosts.includes(host) ? profile : null, sequence: messageSequence }); return;
  }
  if (raw?.type === 'rows' && sender.tab && authenticated && profile) {
    try {
      const host = new URL(sender.url ?? '').hostname;
      if (!profile.hosts.includes(host)) return;
      const observations = observationsSchema.parse(raw.observations);
      if (sender.tab.id !== undefined && httpsHost(sender.url)) scanned.set(frameKey(sender.tab.id, sender.frameId ?? 0), {
        tabId: sender.tab.id, frameId: sender.frameId ?? 0, host, kind: sender.frameId ? 'frame' : 'window', count: observations.length, scannedAt: Date.now(),
      });
      send({ type: 'snapshot', host, observations });
      reply({ ok: true });
    } catch { reply({ ok: false }); }
  }
});
chrome.alarms.create('baccarat-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { void connect(); void presence(); });
chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.runtime.onInstalled.addListener(() => { void configureScripts(); void connect(); });
chrome.permissions.onAdded.addListener(() => { void configureScripts(); void presence(); });
chrome.permissions.onRemoved.addListener(() => { void configureScripts(); void presence(); });
function forgetTab(tabId: number) {
  for (const frames of [discovered, scanned]) for (const [key, frame] of frames) if (frame.tabId === tabId) frames.delete(key);
}
chrome.tabs.onRemoved.addListener(tabId => { forgetTab(tabId); void presence(); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') forgetTab(tabId);
  if (change.status === 'complete') void discover().then(presence).catch(() => {});
});
setInterval(() => { if (authenticated) { send({ type: 'ping' }); void presence(); } else void connect(); }, 5000);
void connect();
