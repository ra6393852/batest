import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleOutcomes, smallRoadBitmap } from '../fixtures/road-bitmap';

test('image Ctrl+V works on dashboard and focused inputs while text paste stays unchanged', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-paste-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])] });
    const page = await app.firstWindow();
    await expect(page.getByRole('group', { name: '그림판 캡처 붙여넣기 안내' })).toContainText('Win');
    await expect(page.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Chrome 확장 설치 폴더', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '시뮬레이션 실행', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '허용된 프로필 가져오기', exact: true })).toHaveCount(0);
    const copyRoad = async (format: 'bead' | 'big-road') => {
      const road = smallRoadBitmap(format);
      await app!.evaluate(async ({ nativeImage, clipboard, ClipboardItem }, input) => {
        const png = nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG();
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
      }, { width: road.width, height: road.height, bitmap: Buffer.from(road.bitmap).toString('base64') });
    };
    await copyRoad('bead');
    await page.getByRole('heading', { name: 'Baccarat Live Analyzer', exact: true }).click();
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    await copyRoad('big-road');
    const room = page.getByLabel('이미지 방 이름'); await room.fill('붙여넣기 방');
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('image-detected-count')).toHaveText('35개 결과 인식 추정');
    await expect(room).toHaveValue('붙여넣기 방');
    await copyRoad('bead');
    const sequence = page.getByLabel('이미지 슈'); await sequence.fill('BPT');
    // Exercise the native Edit > Paste route, not a synthetic DOM paste event.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    await expect(sequence).toHaveValue('BPT');
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('P B T'); });
    await sequence.fill(''); await page.keyboard.press('Control+v');
    await expect(sequence).toHaveValue('P B T');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('클립보드에 이미지가 없습니다');
    await expect(page.getByTestId('image-detected-count')).toHaveCount(0);
    const oldReview = await page.evaluate(() => window.analyzer.reviewSequence('BPT'));
    await app.evaluate(async ({ nativeImage, clipboard, ClipboardItem }) => {
      const png = nativeImage.createFromBitmap(Buffer.alloc(80 * 60 * 4, 255), { width: 80, height: 60 }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    });
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-preview-status')).toContainText('이미지 불러오기 완료');
    await expect(page.getByTestId('image-preview-status')).toContainText('자동 인식 실패');
    await expect(page.getByRole('img', { name: '불러온 원본 이미지', exact: true })).toBeVisible();
    await expect(page.getByTestId('image-detected-count')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.evaluate(reviewId => window.analyzer.saveImage({ reviewId, roomName: 'stale', shoeId: 's', startRound: 1, outcomes: ['B', 'P', 'T'] }), oldReview.id)).rejects.toThrow('다시 읽고');
    expect((await page.evaluate(() => window.analyzer.snapshot())).results).toHaveLength(0);
    await page.screenshot({ path: 'test-results/clipboard-unrecognized.png' });
    await copyRoad('bead');
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    await expect(page.getByTestId('image-preview-status')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await page.evaluate(() => window.analyzer.snapshot())).results).toHaveLength(0);
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/clipboard-dashboard.png' });
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});

test('clipboard preview, correction, confirmation, deduplication and restart persistence', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-image-')); let app: ElectronApplication | undefined;
  const launch = () => electron.launch({
    executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
    args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])],
  });
  try {
    app = await launch(); const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true })).toBeVisible();
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 250;
      const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 120, 250);
      ['B', 'P', 'T', 'B', 'B', 'P', 'T', 'P'].forEach((outcome, index) => {
        const x = 30 + Math.floor(index / 6) * 36, y = 30 + (index % 6) * 36;
        context.fillStyle = ({ B: '#ef1424', P: '#1495f8', T: '#14bd28' } as Record<string, string>)[outcome];
        context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#fff'; context.font = 'bold 12px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(outcome, x, y);
      });
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await app.evaluate(async ({ clipboard, ClipboardItem }, value) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(Buffer.from(value, 'base64'))], { type: 'image/png' }) })]);
    }, encoded);
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('8개 결과 인식 추정');
    expect((await page.evaluate(() => window.analyzer.snapshot())).results).toHaveLength(0);
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    await expect(page.getByLabel('이미지 결과 3', { exact: true })).toHaveValue('T');
    await page.getByLabel('이미지 방 이름').fill('그림판 테스트 방'); await page.getByLabel('이미지 슈').fill('image-test-1');
    await page.getByLabel('이미지 시작 번호').fill('10');
    const confirmed = page.getByRole('checkbox'); await confirmed.check();
    await page.getByLabel('이미지 결과 1', { exact: true }).selectOption('P');
    await expect(confirmed).not.toBeChecked(); await confirmed.check();
    await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText('8');
    const snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.results[0]).toMatchObject({ outcome: 'P', round: 10, source: 'manual', historical: true });
    expect(snapshot.results.at(-1)?.round).toBe(17); expect(snapshot.stats.comparisons).toBe(0);
    expect(snapshot.forecasts.filter(row => row.targetRound === 18)).toHaveLength(4);
    await page.evaluate(input => window.analyzer.appendManual(input), { roomId: snapshot.roomId!, shoeId: snapshot.shoeId!, round: 18, outcome: 'B' as const });
    await expect(page.getByTestId('total-results')).toHaveText('9');
    const live = await page.evaluate(() => window.analyzer.snapshot());
    expect(live.results.at(-1)).toMatchObject({ round: 18, outcome: 'B', historical: false, source: 'manual' });
    expect(live.stats.comparisons).toBe(1); expect(live.forecasts.filter(f => f.targetRound === 18 && f.horizon === 1).every(f => f.mark === 'O' || f.mark === 'X')).toBe(true);
    await expect(page.evaluate(input => window.analyzer.appendManual(input), { roomId: live.roomId!, shoeId: live.shoeId!, round: 18, outcome: 'P' as const })).rejects.toThrow('다음 회차');
    expect((await page.evaluate(() => window.analyzer.snapshot())).results.at(-1)?.outcome).toBe('B');
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toBeVisible();
    await page.getByLabel('이미지 결과 1', { exact: true }).selectOption('P'); await confirmed.check();
    await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('image-save-status')).toContainText('새 기록 0개');
    await page.screenshot({ path: 'test-results/image-dashboard.png' });
    await app.close(); app = await launch(); const reopened = await app.firstWindow();
    await expect(reopened.getByTestId('total-results')).toHaveText('9');
    expect((await reopened.evaluate(() => window.analyzer.snapshot())).results[0].outcome).toBe('P');
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});

test('small clipboard grids, missing outer borders, watermark, ties and stored forecasts', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-small-road-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])] });
    const page = await app.firstWindow();
    const bead = smallRoadBitmap('bead', true);
    const png = await app.evaluate(({ nativeImage }, input) => nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG().toString('base64'), { width: bead.width, height: bead.height, bitmap: Buffer.from(bead.bitmap).toString('base64') });
    await app.evaluate(async ({ clipboard, ClipboardItem }, value) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(Buffer.from(value, 'base64'))], { type: 'image/png' }) })]);
    }, png);
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    for (let i = 0; i < exampleOutcomes.length; i++) await expect(page.getByLabel(`이미지 결과 ${i+1}`, { exact: true })).toHaveValue(exampleOutcomes[i]);
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText('38');
    const road = smallRoadBitmap('big-road');
    for (const y of [4, 76]) for (let x = 6; x <= 462; x++) road.bitmap.set([255, 255, 255, 255], (y * road.width + x) * 4);
    for (const x of [6, 462]) for (let y = 4; y <= 76; y++) road.bitmap.set([255, 255, 255, 255], (y * road.width + x) * 4);
    for (let x = 310; x < 410; x++) road.bitmap.set([180, 180, 180, 255], (60 * road.width + x) * 4);
    await app.evaluate(async ({ nativeImage, clipboard, ClipboardItem }, input) => {
      const png = nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    }, { width: road.width, height: road.height, bitmap: Buffer.from(road.bitmap).toString('base64') });
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('35개 결과 인식 추정');
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    const markers = page.locator('.tie-field input'); await expect(markers).toHaveCount(2);
    await markers.nth(0).fill('1'); await markers.nth(1).fill('2');
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText('38');
    const snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.results.map(row => row.outcome)).toEqual(exampleOutcomes); expect(snapshot.stats.counts).toEqual({ B: 19, P: 16, T: 3 });
    await page.screenshot({ path: 'test-results/small-road-dashboard.png' });
    expect(snapshot.forecasts.filter(f => f.targetRound === 39 && f.horizon === 1)).toHaveLength(4);
    expect(snapshot.stats.comparisons).toBe(0);
    await expect(page.getByRole('button', { name: '플레이어 결과 기록', exact: true })).toHaveCount(0);
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});
