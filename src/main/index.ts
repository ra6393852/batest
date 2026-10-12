import { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { AnalyzerStore } from './store';
import { SITE_URL, navigationAllowed } from './browser-policy';
import { profileSchema, observationsSchema, observationSchema } from '../shared/validation';
import { parseOCR } from '../collector/ocr';
import { ObservationTracker } from '../collector/dom';
import type { AdapterProfile, CollectorStatus } from '../shared/types';

let store: AnalyzerStore, window: BrowserWindow, browser: WebContentsView | undefined;
let mode: 'site' | 'demo' = 'site', profile: AdapterProfile | null = null;
let ocrWorker: import('tesseract.js').Worker | undefined;
let ocrBusy = false, ocrTracker = new ObservationTracker();
let lastOCR = '';
const rendererPath = join(__dirname, '../renderer/index.html');
const demoPath = join(__dirname, '../fixtures/table.html');
const rendererURL = pathToFileURL(rendererPath).href;
const isSmoke = process.argv.includes('--smoke-test');
// Smoke tests use an isolated DB and session, never the user's records or login state.
if (isSmoke) { const dataArg = process.argv.find(v => v.startsWith('--test-data='));
  if (!dataArg) throw new Error('Smoke test requires an isolated --test-data directory');
  app.setPath('userData', dataArg.slice('--test-data='.length)); }
const boundsSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(1), height: z.number().int().min(1) }).strict();
function local(event: IpcMainInvokeEvent | IpcMainEvent) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererURL)
    throw new Error('허용되지 않은 호출입니다.');
}
function remote(event: IpcMainInvokeEvent | IpcMainEvent) {
  if (!browser || event.sender !== browser.webContents || event.senderFrame !== browser.webContents.mainFrame) throw new Error('허용되지 않은 수집 호출입니다.');
  const url = event.senderFrame.url;
  if (mode === 'demo' ? url !== pathToFileURL(demoPath).href : !navigationAllowed(url, profile?.hosts ?? [])) throw new Error('허용되지 않은 수집 출처입니다.');
}
function status(state: CollectorStatus['state'], message: string, history: CollectorStatus['history'] = 'unknown') {
  if (!window.isDestroyed()) window.webContents.send('collector:status', { state, message, history });
}
function changed() { window.webContents.send('analyzer:changed'); }
function closeBrowser() {
  if (browser) { window.contentView.removeChildView(browser); browser.webContents.close(); browser = undefined; }
  ocrTracker = new ObservationTracker(); lastOCR = '';
}
async function openBrowser(nextMode: 'site' | 'demo') {
  if (isSmoke && nextMode !== 'demo') throw new Error('오프라인 테스트 모드에서는 실제 사이트를 열 수 없습니다.');
  closeBrowser(); mode = nextMode;
  browser = new WebContentsView({ webPreferences: {
    preload: join(__dirname, '../preload/collector.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false, partition: isSmoke ? 'test-site' : 'persist:baccarat-site',
  } });
  const contents = browser.webContents;
  window.contentView.addChildView(browser);
  browser.setBounds({ x: 24, y: 170, width: 1000, height: 350 });
  const allowedHosts = () => [...new Set(['box-1515.com', 'www.box-1515.com', ...(profile?.hosts ?? [])])];
  contents.on('will-navigate', (event, url) => { if (mode === 'site' && !navigationAllowed(url, allowedHosts())) { event.preventDefault(); status('unsupported', '다른 출처로의 이동이 차단됨 · 허용된 제공자 프로필 확인 필요'); } });
  contents.on('will-redirect', (event, url) => { if (mode === 'site' && !navigationAllowed(url, allowedHosts())) { event.preventDefault(); status('unsupported', '허용되지 않은 로그인/제공자 출처로의 리디렉션이 차단되었습니다.'); } });
  contents.setWindowOpenHandler(({ url }) => { if (mode === 'site' && navigationAllowed(url, allowedHosts())) void contents.loadURL(url).catch(() => status('error', '사이트 이동 실패')); return { action: 'deny' }; });
  contents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame) status('error', '사이트 접속 실패 · 내장 브라우저 허용 여부와 네트워크 확인 필요'); });
  contents.on('did-finish-load', () => {
    if (mode === 'demo') status('demo', '테스트 화면 · 실제 게임 기록과 분리 저장', 'visible-only');
    else status(profile && navigationAllowed(contents.getURL(), profile.hosts) ? 'collecting' : 'unsupported', profile ? '허용된 프로필로 수집 시도 중 · 미인식 영역/iframe은 자동 확정하지 않음' : '사이트 어댑터 미검증 · 로그인은 직접 수행 · 자동 수집 꺼짐');
  });
  try { await (mode === 'demo' ? contents.loadFile(demoPath) : contents.loadURL(SITE_URL)); }
  catch { status('error', '사이트 접속 실패 · 접근 제한을 우회하지 않습니다.'); }
}

// sql.js writes whole-file atomic snapshots; a second writer must not overwrite the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.focus(); } });
void app.whenReady().then(async () => {
  store = await AnalyzerStore.open(join(app.getPath('userData'), 'baccarat.sqlite'));
  const profilePath = join(app.getPath('userData'), 'adapter-profile.json');
  if (existsSync(profilePath)) { try { profile = profileSchema.parse(JSON.parse(readFileSync(profilePath, 'utf8'))); } catch { profile = null; } }
  session.fromPartition(isSmoke ? 'test-site' : 'persist:baccarat-site').setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.fromPartition(isSmoke ? 'test-site' : 'persist:baccarat-site').setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1400, height: 1000, minWidth: 1000, minHeight: 700, title: 'Baccarat Live Analyzer',
    webPreferences: { preload: join(__dirname, '../preload/dashboard.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.handle('analyzer:snapshot', (event, room, shoe) => { local(event); return store.snapshot(z.string().max(120).optional().parse(room), z.string().max(120).optional().parse(shoe)); });
  ipcMain.handle('browser:open', async (event, selected) => { local(event); await openBrowser(z.enum(['site', 'demo']).parse(selected)); });
  ipcMain.handle('browser:close', event => { local(event); closeBrowser(); status('idle', '브라우저 닫힘'); });
  ipcMain.on('browser:bounds', (event, raw) => { local(event); if (!browser) return; const b = boundsSchema.parse(raw);
    const [width, height] = window.getContentSize(); if (b.x + b.width <= width && b.y + b.height <= height) browser.setBounds(b); });
  ipcMain.handle('analyzer:confirm', (event, id, accept) => { local(event); store.confirm(z.uuid().parse(id), z.boolean().parse(accept)); changed(); });
  ipcMain.handle('analyzer:export', async (event, room, shoe) => { local(event); const roomId = z.string().max(120).parse(room), shoeId = z.string().max(120).parse(shoe);
    const data = store.csv(roomId, shoeId); const result = await dialog.showSaveDialog(window, { defaultPath: 'baccarat-results.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (result.canceled || !result.filePath) return false; writeFileSync(result.filePath, data, { mode: 0o600 }); return true; });
  ipcMain.handle('browser:profile', async event => { local(event);
    const answer = await dialog.showMessageBox(window, { type: 'info', buttons: ['취소', '허용된 프로필 가져오기'], defaultId: 0, cancelId: 0,
      message: '사이트/제공자가 허용한 읽기 전용 DOM/OCR 접근만 사용하세요.', detail: '프로필에는 CSS 선택자와 방·슈·회차 속성만 포함합니다. 인증 정보와 스크립트는 허용되지 않습니다. 실제 사이트 검증을 대신하지 않습니다.' });
    if (answer.response !== 1) return false;
    const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Adapter JSON', extensions: ['json'] }] });
    if (selected.canceled) return false;
    const bytes = readFileSync(selected.filePaths[0]); if (bytes.length > 32_768) throw new Error('프로필 파일이 너무 큽니다.');
    const next = profileSchema.parse(JSON.parse(bytes.toString('utf8')));
    writeFileSync(profilePath, JSON.stringify(next, null, 2), { mode: 0o600 }); profile = next;
    closeBrowser(); status('idle', '프로필 저장됨 · 사이트를 다시 열어 수집 상태 확인'); return true;
  });
  ipcMain.handle('collector:config', event => { if (!browser || event.sender !== browser.webContents || event.senderFrame !== browser.webContents.mainFrame) throw new Error('잘못된 출처');
    const valid = mode === 'demo' ? event.senderFrame.url === pathToFileURL(demoPath).href : navigationAllowed(event.senderFrame.url, profile?.hosts ?? []);
    return { mode, profile: valid ? profile : null }; });
  ipcMain.handle('collector:observations', (event, raw) => { remote(event);
    const observations = observationsSchema.parse(raw).map(o => ({ ...o, source: mode === 'demo' ? 'demo' as const : 'dom' as const }));
    store.ingest(observations); changed(); status(mode === 'demo' ? 'demo' : 'collecting', `${observations.length}개 결과 감지 · 보이는 기록만 복원 · 전체 이력은 미검증`, 'visible-only'); });
  ipcMain.on('collector:failed', event => { try { remote(event); status('error', '방·슈·회차 또는 결과 형식 확인 필요 · 자동 수집 중단 항목 있음'); } catch { /* no raw page data in logs */ } });
  ipcMain.on('collector:empty', event => { try { remote(event); status('unsupported', '명확한 방·슈·회차·결과를 찾지 못함 · 해당 화면의 수집은 미검증'); } catch { /* ignore untrusted senders */ } });
  ipcMain.handle('collector:ocr', async (event, raw) => {
    remote(event); if (!profile?.ocr || mode !== 'site' || ocrBusy || !browser) return;
    const data = z.object({ roomId: z.string().max(120), roomName: z.string().max(120), shoeId: z.string().max(120), round: z.number().int().positive(), rect: boundsSchema }).strict().parse(raw);
    const key = JSON.stringify([data.roomId, data.shoeId, data.round]); if (key === lastOCR) return;
    const bounds = browser.getBounds(), rect = data.rect;
    if (rect.width * rect.height > 2_000_000 || rect.x + rect.width > bounds.width || rect.y + rect.height > bounds.height) return;
    const capturedBrowser = browser, senderFrame = event.senderFrame;
    ocrBusy = true;
    try {
      if (!ocrWorker) {
        const { createWorker } = await import('tesseract.js');
        const resources = app.isPackaged ? join(process.resourcesPath, 'ocr') : null;
        // Local bundled language model: no screenshots sent to an external service.
        ocrWorker = await createWorker('eng', 1, {
          langPath: resources ? join(resources, 'eng') : join(app.getAppPath(), 'node_modules/@tesseract.js-data/eng/4.0.0'),
          workerPath: resources ? join(resources, 'worker.cjs') : join(__dirname, 'ocr-worker.cjs'),
          cacheMethod: 'none', gzip: true,
        });
      }
      const screenshot = await capturedBrowser.webContents.capturePage(rect);
      const { data: recognized } = await ocrWorker.recognize(screenshot.toPNG());
      if (browser !== capturedBrowser || senderFrame !== capturedBrowser.webContents.mainFrame) return;
      const parsed = parseOCR(recognized.text, recognized.confidence);
      if (!parsed) { status('error', 'OCR 결과가 B/P/T 단일 결과가 아님 · 자동 확정하지 않음'); return; }
      const observation = observationSchema.parse({ roomId: data.roomId, roomName: data.roomName, shoeId: data.shoeId, round: data.round, ...parsed, source: 'ocr', historical: true });
      store.ingest(ocrTracker.filter([observation])); lastOCR = key; changed();
    } finally { ocrBusy = false; }
  });
  await window.loadFile(rendererPath);
  window.on('close', () => { closeBrowser(); });
}).catch(() => { dialog.showErrorBox('실행 실패', '데이터베이스 또는 앱 초기화 실패. 기존 데이터 파일은 삭제하지 마세요.'); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { store?.close(); if (ocrWorker) void ocrWorker.terminate(); });
