import { profileSchema, observationsSchema } from '../shared/validation';
import type { AdapterProfile } from '../shared/types';
let socket: WebSocket | null = null, profile: AdapterProfile | null = null, authenticated = false;
let connecting = false, pairingCode: string | null = null;
let status = '프로그램 실행 대기', latestError = '';
let messageSequence = 0;
const BRIDGE_URL = 'ws://127.0.0.1:38741/bridge';
const send = (message: unknown) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
async function grantedOrigins() {
  return (await chrome.permissions.getAll()).origins?.filter(o => o.startsWith('https://')) ?? [];
}
async function configureScripts() {
  const origins = await grantedOrigins();
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
}
async function presence() {
  if (!authenticated) return;
  const origins = await grantedOrigins();
  const tabs = origins.length ? await chrome.tabs.query({ url: origins }) : [];
  send({ type: 'presence', tabs: tabs.length });
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
        authenticated = true; status = profile ? '프로그램 연결됨 · 결과 수집 대기' : '프로그램 연결됨 · 실제 결과 인식 프로필 미설정'; latestError = '';
        messageSequence++;
        await configureScripts(); await presence();
      } else if (message.type === 'error') latestError = '앱에서 결과 형식 또는 저장 상태 확인 필요';
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
    reply({ status, error: latestError, connected: authenticated, profileHosts: profile?.hosts ?? [] }); return;
  }
  if (raw?.type === 'pair' && ui && typeof raw.code === 'string' && /^\d{6}$/.test(raw.code)) {
    pairingCode = raw.code; socket?.close(); socket = null; connecting = false;
    void connect(); reply({ ok: true }); return;
  }
  if (raw?.type === 'grant' && ui) { void configureScripts().then(presence); reply({ ok: true }); return; }
  if (raw?.type === 'config' && sender.tab) {
    let host = ''; try { host = new URL(sender.url ?? '').hostname; } catch { /* no page URLs in logs */ }
    reply({ profile: authenticated && profile?.hosts.includes(host) ? profile : null, sequence: messageSequence }); return;
  }
  if (raw?.type === 'rows' && sender.tab && authenticated && profile) {
    try {
      const host = new URL(sender.url ?? '').hostname;
      if (!profile.hosts.includes(host)) return;
      send({ type: 'snapshot', host, observations: observationsSchema.parse(raw.observations) });
      reply({ ok: true });
    } catch { reply({ ok: false }); }
  }
});
chrome.alarms.create('baccarat-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { void connect(); void presence(); });
chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.runtime.onInstalled.addListener(() => { void configureScripts(); void connect(); });
chrome.permissions.onAdded.addListener(() => { void configureScripts(); void presence(); });
chrome.tabs.onRemoved.addListener(() => { void presence(); });
setInterval(() => { if (authenticated) { send({ type: 'ping' }); void presence(); } else void connect(); }, 5000);
void connect();
