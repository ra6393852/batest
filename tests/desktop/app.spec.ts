import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorker } from 'tesseract.js';
import { parseOCR } from '../../src/collector/ocr';
let app: ElectronApplication;
test('automatic fixture collection, causal scoring, room/shoe separation and restart persistence', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-desktop-'));
  try {
    const launch = () => electron.launch({
      executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'false' },
    });
    app = await launch(); const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Baccarat Live Analyzer' })).toBeVisible();
    await expect(page.getByRole('button', { name: '테스트 화면', exact: true })).toHaveCount(0);
    // Collector integration remains an internal fixture, outside the clipboard-only UI.
    await page.evaluate(async () => { await window.analyzer.open('demo'); window.analyzer.setBrowserBounds({ x: 24, y: 170, width: 600, height: 350 }); });
    await expect(page.getByTestId('total-results')).toHaveText('6');
    await expect(page.getByRole('button', { name: '뱅커 결과 기록', exact: true })).toHaveCount(0);
    let snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.results.every(r => r.historical)).toBe(true);
    expect(snapshot.forecasts.filter(f => f.targetRound === 7)).toHaveLength(4);
    const game = app.windows().find(p => p.url().endsWith('table.html'))!;
    await game.getByRole('button', { name: '새 결과 B', exact: true }).click();
    await expect(page.getByTestId('total-results')).toHaveText('7');
    snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.forecasts.filter(f => f.targetRound === 7).every(f => f.mark === 'O' || f.mark === 'X')).toBe(true);
    expect(snapshot.stats.comparisons).toBe(1);
    await game.getByRole('button', { name: '새 결과 T', exact: true }).click();
    await expect(page.getByTestId('total-results')).toHaveText('8');
    snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.stats.accuracy.A.all.count).toBe(2); expect(snapshot.stats.accuracy.A.all.noTieCount).toBe(1);
    await game.getByRole('button', { name: '방 이동', exact: true }).click();
    await expect(page.getByTestId('total-results')).toHaveText('6');
    expect((await page.evaluate(() => window.analyzer.snapshot())).rooms).toHaveLength(2);
    await game.getByRole('button', { name: '새 슈', exact: true }).click();
    await game.getByRole('button', { name: '새 결과 P', exact: true }).click();
    await expect(page.getByTestId('total-results')).toHaveText('1');
    expect((await page.evaluate(() => window.analyzer.snapshot())).shoeId).toBe('demo-shoe-2');
    await page.screenshot({ path: 'test-results/dashboard.png' });
    const image = await game.locator('#ocr-text').screenshot();
    const ocrRoot = process.env.DESKTOP_TEST_OCR_RESOURCES;
    const worker = await createWorker('eng', 1, {
      langPath: ocrRoot ? join(ocrRoot, 'eng') : join(process.cwd(), 'node_modules/@tesseract.js-data/eng/4.0.0'),
      workerPath: ocrRoot ? join(ocrRoot, 'worker.cjs') : join(process.cwd(), 'dist/main/ocr-worker.cjs'),
      gzip: true, cacheMethod: 'none',
    });
    try { const recognized = await worker.recognize(image); expect(parseOCR(recognized.data.text, recognized.data.confidence)?.outcome).toBe('B'); }
    finally { await worker.terminate(); }
    await app.close(); app = await launch(); const reopened = await app.firstWindow();
    await expect(reopened.getByRole('heading', { name: 'Baccarat Live Analyzer' })).toBeVisible();
    const restored = await reopened.evaluate(() => window.analyzer.snapshot('demo-alpha', 'demo-shoe-1'));
    expect(restored.results).toHaveLength(8); expect(restored.stats.comparisons).toBe(2);
    // Remote fixture has no privileged bridge or Node globals.
    await reopened.evaluate(async () => { await window.analyzer.open('demo'); window.analyzer.setBrowserBounds({ x: 24, y: 170, width: 600, height: 350 }); });
    await expect.poll(() => app.windows().some(p => p.url().endsWith('table.html'))).toBe(true);
    const newGame = app.windows().find(p => p.url().endsWith('table.html'))!;
    expect(await newGame.evaluate(() => typeof (window as unknown as { analyzer?: unknown }).analyzer)).toBe('undefined');
    expect(await newGame.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
  } finally { if (app) await app.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});
