const get = (id: string) => document.getElementById(id)!;
let tabHost: string | null = null;
const recognition = { unconfigured: '실제 결과 인식 기능 미설정 · 자동 수집 안 됨', waiting: '읽기 허용됨 · 게임 정보 확인 대기', unmatched: '읽기 허용됨 · 이 화면의 방·슈·회차·결과를 찾지 못함', observed: '게임 결과 인식됨' };
let renderedTargets = '';
void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  try { const url = new URL(tabs[0]?.url ?? ''); if (url.protocol === 'https:' && !url.username && !url.password) tabHost = url.hostname; } catch { /* only the hostname is retained */ }
});
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'state' });
  get('status').textContent = state.status; get('error').textContent = state.error;
  const targets: ChromeGameTarget[] = state.targets ?? [];
  const key = JSON.stringify(targets);
  if (key !== renderedTargets) {
    renderedTargets = key; get('targets').replaceChildren();
    for (const target of targets) {
      const row = document.createElement('div'); row.className = 'target';
      const title = document.createElement('strong'); title.textContent = `${target.kind === 'window' ? '게임 창' : '게임 프레임'} · ${target.host}`;
      const note = document.createElement('p'); note.textContent = target.permission ? recognition[target.recognition] : '이 도메인의 읽기 권한이 필요합니다.';
      row.append(title, note);
      if (!target.permission) {
        const button = document.createElement('button'); button.textContent = '이 게임 도메인 읽기 허용'; button.addEventListener('click', () => grant(target.host)); row.append(button);
      }
      get('targets').append(row);
    }
  }
}
get('pair').addEventListener('click', () => {
  const code = (get('code') as HTMLInputElement).value.trim();
  if (!/^\d{6}$/.test(code)) { get('error').textContent = '앱에 표시된 6자리 연결 코드를 입력하세요.'; return; }
  void chrome.runtime.sendMessage({ type: 'pair', code }).then(refresh);
});
function grant(host: string | null) {
  if (!host || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) { get('error').textContent = 'HTTPS 바카라 탭의 도메인을 확인하세요. 전체 로그인 링크는 입력하지 마세요.'; return; }
  void chrome.permissions.request({ origins: [`https://${host}/*`] }).then(allowed => {
    if (!allowed) { get('error').textContent = 'Chrome에서 해당 도메인 읽기를 허용해야 연결할 수 있습니다.'; return; }
    return chrome.runtime.sendMessage({ type: 'grant' }).then(refresh);
  });
}
get('grant-tab').addEventListener('click', () => grant(tabHost));
get('grant-host').addEventListener('click', () => grant((get('host') as HTMLInputElement).value.trim().toLowerCase()));
get('find-games').addEventListener('click', () => {
  void chrome.permissions.request({ permissions: ['webNavigation'] }).then(async allowed => {
    if (!allowed) { get('error').textContent = '새 창을 찾으려면 Chrome의 탐색 정보 권한을 허용하세요.'; return; }
    get('find-games').textContent = '게임 창 확인 중';
    try { await chrome.runtime.sendMessage({ type: 'discover' }); await refresh(); }
    finally { get('find-games').textContent = '열린 게임 창 확인'; }
  });
});
void refresh(); setInterval(() => { void refresh(); }, 1000);
import type { ChromeGameTarget } from '../shared/types';
