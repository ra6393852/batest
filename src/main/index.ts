import { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, shell, nativeImage, clipboard, type NativeImage, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { AnalyzerStore } from './store';
import { SITE_URL, navigationAllowed } from './browser-policy';
import { profileSchema, observationsSchema, observationSchema } from '../shared/validation';
import { parseOCR } from '../collector/ocr';
import { ObservationTracker } from '../collector/dom';
import { ChromeBridge } from './chrome-bridge';
import { ImageImport } from './image-import';
import { ScoreReader } from './score-reader';
import { WindowCapture } from './window-capture';
import {BoardReader} from './board-reader';
import {AccessLock,passwordKey,isolatedTestDirectory} from './access-lock';
import {ADMIN_VERIFIER} from './admin-verifier';
import {CaptureUpdates} from './capture-updates';
import { analyzeBeadBitmap, ImageRecognitionError } from '../collector/bead-image';
import { parseSequence } from '../analysis/simulation';
import type { AdapterProfile, CollectorStatus, ImagePreview, ImageReview } from '../shared/types';

let store: AnalyzerStore, window: BrowserWindow, browser: WebContentsView | undefined;
let mode: 'site' | 'demo' = 'site', profile: AdapterProfile | null = null;
let ocrWorker: import('tesseract.js').Worker | undefined;
let ocrBusy = false, ocrTracker = new ObservationTracker();
let lastOCR = '';
let chromeBridge: ChromeBridge | undefined;
const imageImport = new ImageImport();
let scoreReader: ScoreReader | undefined;
let windowCapture: WindowCapture | undefined;
let access:AccessLock;
async function inspectImage(image: NativeImage): Promise<ImageReview | ImagePreview> {
  imageImport.invalidate();
  if (image.isEmpty()) throw new Error('이미지가 없습니다. 그림판을 캡처해 복사한 뒤 이미지 붙여넣기를 누르세요.');
  const { width, height } = image.getSize();
  if (width * height > 12_000_000) throw new Error('이미지는 최대 1,200만 픽셀까지 읽을 수 있습니다.');
  let analysis;
  try { analysis = analyzeBeadBitmap(width, height, image.toBitmap()); }
  catch (error) {
    // Successful image intake remains visible even when chart recognition fails.
    // No review ID or outcomes are issued, so this preview cannot be stored as results.
    return { preview: image.toDataURL(), recognitionError: error instanceof Error ? error.message : '그림판 결과를 자동으로 읽지 못했습니다.', diagnostics: error instanceof ImageRecognitionError ? error.diagnostics : undefined };
  }
  // Retain the original clipboard pixels for 100%/150% review. Display zoom
  // never resamples the bitmap used by recognition.
  const review = imageImport.create(analysis, image.toDataURL());
  if (analysis.beadCells?.length) {
    try {
      const resources = app.isPackaged ? join(process.resourcesPath, 'ocr') : null;
      scoreReader ??= new ScoreReader(resources, resources ? join(resources, 'worker.cjs') : join(__dirname, 'ocr-worker.cjs'));
      const read = await scoreReader.read(width, height, image.toBitmap(), analysis.beadCells);
      review.scores = read.scores; review.scoreConfidences = read.confidences;
      review.warnings.push('숫자는 그림판에 표시된 점수로 기록합니다. 0~9 점수와 승패를 원본과 확인하세요. 읽지 못한 숫자는 비워 두며 점수 없이 저장할 수 있습니다.');
    } catch { review.scores = analysis.outcomes.map(() => null); review.warnings.push('점수 자동 읽기를 완료하지 못했습니다. 숫자는 원본을 보고 입력하거나 비워 두세요.'); }
  }
  return review;
}
const rendererPath = join(__dirname, '../renderer/index.html');
const demoPath = join(__dirname, '../fixtures/table.html');
const rendererURL = pathToFileURL(rendererPath).href;
const isSmoke = process.argv.includes('--smoke-test');
// Smoke tests use an isolated DB and session, never the user's records or login state.
if (isSmoke) { const dataArg = process.argv.find(v => v.startsWith('--test-data='));
  if (!dataArg) throw new Error('Smoke test requires an isolated --test-data directory');
  app.setPath('userData', isolatedTestDirectory(dataArg.slice('--test-data='.length))); }
const boundsSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(1), height: z.number().int().min(1) }).strict();
function local(event: IpcMainInvokeEvent | IpcMainEvent,requireUnlock=true) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererURL)
    throw new Error('허용되지 않은 호출입니다.');
  if(requireUnlock&&access.status().locked)throw new Error('관리자 암호로 잠금을 해제하세요.');
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
  const message=`실행 버전 ${app.getVersion()}을 새로 시작하지 못했습니다. 이미 실행 중인 Baccarat Live Analyzer를 완전히 종료한 뒤 이 EXE를 다시 실행하세요. 기존 창만 표시되면 이전 버전의 판독 로직이 계속 실행될 수 있습니다.`;
  if(isSmoke)console.error(message);
  else dialog.showErrorBox('이미 실행 중인 분석기를 종료하세요',message);
  app.quit();
} else {
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.focus(); } });
void app.whenReady().then(async () => {
  const fixturePassword=isSmoke?process.env.DESKTOP_TEST_PASSWORD:undefined;
  const verifier=fixturePassword?{salt:ADMIN_VERIFIER.salt,digest:(await passwordKey(fixturePassword,ADMIN_VERIFIER.salt)).toString('hex')}:ADMIN_VERIFIER;
  access=new AccessLock(verifier);
  store = await AnalyzerStore.open(join(app.getPath('userData'), 'baccarat.sqlite'));
  const profilePath = join(app.getPath('userData'), 'adapter-profile.json');
  if (existsSync(profilePath)) { try { profile = profileSchema.parse(JSON.parse(readFileSync(profilePath, 'utf8'))); } catch { profile = null; } }
  session.fromPartition(isSmoke ? 'test-site' : 'persist:baccarat-site').setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.fromPartition(isSmoke ? 'test-site' : 'persist:baccarat-site').setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1400, height: 1000, minWidth: 1000, minHeight: 700, title: 'Baccarat Live Analyzer',
    webPreferences: { preload: join(__dirname, '../preload/dashboard.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const ocrResources=app.isPackaged?join(process.resourcesPath,'ocr'):null;
  const workerFile=ocrResources?join(ocrResources,'worker.cjs'):join(__dirname,'ocr-worker.cjs');
  const boardWorker=app.isPackaged?join(process.resourcesPath,'analysis','board-worker.cjs'):join(__dirname,'board-worker.cjs');
  const captureUpdates=new CaptureUpdates();
  windowCapture=new WindowCapture(store,new ScoreReader(ocrResources,workerFile),new BoardReader(boardWorker),
    info=>{if(!window.isDestroyed())window.webContents.send('capture:changed',captureUpdates.next(info));},changed);
  ipcMain.handle('access:status',event=>{local(event,false);return access.status();});
  let chromeStarting:Promise<void>|undefined;
  ipcMain.handle('access:unlock',async(event,password)=>{local(event,false);const result=await access.unlock(password);
    if(!result.locked){chromeStarting??=startChromeBridge();await chromeStarting;}return result;});
  ipcMain.handle('capture:windows',async event=>{local(event);return windowCapture!.windows();});
  ipcMain.handle('capture:start',async(event,id)=>{local(event);await windowCapture!.start(z.string().regex(/^window:\d+:\d+$/).parse(id));});
  ipcMain.handle('capture:stop',event=>{local(event);windowCapture!.stop();});
  ipcMain.handle('capture:info',event=>{local(event);return windowCapture!.current();});
  ipcMain.handle('capture:new-shoe',event=>{local(event);windowCapture!.newShoe();});
  const dragPoint=z.object({x:z.number().finite().min(-32768).max(32768),y:z.number().finite().min(-32768).max(32768)}).strict();
  let windowDrag:{x:number;y:number;wx:number;wy:number}|undefined;
  ipcMain.on('window:drag-start',(event,raw)=>{local(event,false);const p=dragPoint.safeParse(raw);if(!p.success)return;const [wx,wy]=window.getPosition();windowDrag={...p.data,wx,wy};});
  ipcMain.on('window:drag-move',(event,raw)=>{local(event,false);const p=dragPoint.safeParse(raw);if(!windowDrag||!p.success)return;
    window.setPosition(Math.round(windowDrag.wx+p.data.x-windowDrag.x),Math.round(windowDrag.wy+p.data.y-windowDrag.y));});
  ipcMain.on('window:drag-end',event=>{local(event,false);windowDrag=undefined;});
  window.on('blur',()=>{windowDrag=undefined;});
  const notifyChrome = () => { if (!window.isDestroyed()) window.webContents.send('chrome:changed', chromeBridge?.info()); };
  async function startChromeBridge(){if (!isSmoke && process.argv.includes('--enable-chrome-bridge')) {
    chromeBridge = new ChromeBridge(join(app.getPath('userData'), 'chrome-bridge.json'), () => profile,
      rows => { store.ingest(rows); changed(); }, notifyChrome,
      (message, collecting) => status(collecting ? 'collecting' : 'unsupported', message, collecting ? 'visible-only' : 'unknown'));
    try { await chromeBridge.listen(); } catch {
      // Keep offline analysis available if another local application owns the port.
      await chromeBridge.close(); chromeBridge = undefined;
    }
  }}
  ipcMain.handle('chrome:info', event => { local(event); return chromeBridge?.info() ?? { state: isSmoke ? 'waiting' : 'error', paired: false, pairingCode: null, tabs: 0, targets: [], profileConfigured: false,
    message: isSmoke ? '로컬 테스트 모드 · Chrome 연결 꺼짐' : 'Chrome 연결 포트 38741 사용 실패 · 다른 분석기 인스턴스를 확인하세요.' }; });
  ipcMain.handle('chrome:reset', event => { local(event); chromeBridge?.reset(); });
  ipcMain.handle('chrome:open-panel', event => { local(event); return chromeBridge?.openPanel() ?? false; });
  ipcMain.handle('chrome:extension-folder', async event => { local(event);
    const folder = app.isPackaged ? join(process.resourcesPath, 'chrome-extension') : join(app.getAppPath(), 'dist/extension');
    const error = await shell.openPath(folder); if (error) throw new Error('확장 폴더를 열지 못했습니다.'); return folder;
  });
  ipcMain.handle('image:analyze', async event => { local(event);
    const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: '그림판 이미지', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const file = selected.filePaths[0];
    if (statSync(file).size > 10_000_000) throw new Error('이미지는 최대 10MB까지 읽을 수 있습니다.');
    return inspectImage(nativeImage.createFromBuffer(readFileSync(file)));
  });
  // Explicit user action only. Never read clipboard text/passwords or poll it in the background.
  ipcMain.handle('image:paste', async event => { local(event);
    imageImport.invalidate();
    const items = await clipboard.read();
    for (const item of items) {
      const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/bmp'].includes(type));
      if (!type) continue;
      const blob = await item.getType(type);
      if (!('arrayBuffer' in blob)) continue;
      if (blob.size > 10000000) throw new Error('이미지는 최대 10MB까지 읽을 수 있습니다.');
      return inspectImage(nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())));
    }
    throw new Error('클립보드에 이미지가 없습니다. 그림판을 캡처해 복사한 뒤 이미지 붙여넣기를 누르세요.');
  });
  ipcMain.handle('image:sequence', (event, raw) => { local(event);
    const outcomes = parseSequence(z.string().max(7000).parse(raw));
    return imageImport.create({ outcomes, format: 'bead', tieAfter: [], confidence: 1, bounds: { x: 0, y: 0, width: 0, height: 0 },
      warnings: ['직접 입력한 과거 기록입니다. 원본의 B/P/T 순서와 방·슈·시작 번호를 확인하세요. 사후 O/X 채점하지 않습니다.'] }, '');
  });
  ipcMain.handle('analyzer:manual-result', (event, raw) => { local(event);
    const input = z.object({ roomId: z.string().min(1).max(120), shoeId: z.string().min(1).max(120), round: z.number().int().min(1).max(1000000), outcome: z.enum(['B', 'P', 'T']) }).strict().parse(raw);
    const snapshot = store.snapshot(input.roomId, input.shoeId);
    if (snapshot.roomId !== input.roomId || snapshot.shoeId !== input.shoeId || input.round !== (snapshot.results.at(-1)?.round ?? 0) + 1) throw new Error('방·슈·다음 회차가 변경됐습니다. 현재 기록을 확인하세요.');
    if (snapshot.results.every(result => result.source === 'demo')) throw new Error('테스트 방에는 실제 결과를 추가하지 않습니다. 새 분석 방에 기록을 저장하세요.');
    store.ingest([{ ...input, roomName: snapshot.rooms.find(room => room.id === input.roomId)!.name, confidence: 1, source: 'manual', historical: false }]);
    changed(); status('collecting', `수동 결과 ${input.round}회차 ${input.outcome} 기록 · 사전 예측 채점`, 'visible-only');
  });
  ipcMain.handle('image:save', (event, raw) => { local(event);
    const result = imageImport.save(raw, store); changed();
    status('idle', `그림판 확인 저장 · 새 기록 ${result.added}개${result.pending ? ` · 충돌 확인 대기 ${result.pending}개` : ''}`, 'visible-only'); return result;
  });
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
    closeBrowser(); chromeBridge?.refreshProfile(); status('idle', '프로필 저장됨 · Chrome 연결의 결과 인식 상태 확인'); return true;
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
app.on('will-quit', () => { if (windowCapture) void windowCapture.close(); if (chromeBridge) void chromeBridge.close(); store?.close(); if (ocrWorker) void ocrWorker.terminate(); if (scoreReader) void scoreReader.close(); });
