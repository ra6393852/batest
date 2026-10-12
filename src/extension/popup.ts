const get = (id: string) => document.getElementById(id)!;
let tabHost: string | null = null;
void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  try { const url = new URL(tabs[0]?.url ?? ''); if (url.protocol === 'https:' && !url.username && !url.password) tabHost = url.hostname; } catch { /* only the hostname is retained */ }
});
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'state' });
  get('status').textContent = state.status; get('error').textContent = state.error;
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
    return chrome.runtime.sendMessage({ type: 'grant' }).then(() => { get('error').textContent = '읽기 허용됨 · 앱에 연결하고 결과 인식 프로필을 확인하세요.'; });
  });
}
get('grant-tab').addEventListener('click', () => grant(tabHost));
get('grant-host').addEventListener('click', () => grant((get('host') as HTMLInputElement).value.trim().toLowerCase()));
void refresh(); setInterval(() => { void refresh(); }, 1000);
