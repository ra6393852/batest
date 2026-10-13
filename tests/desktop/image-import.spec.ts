import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('image file preview, manual correction, confirmation, deduplication and restart persistence', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-image-')); let app: ElectronApplication | undefined;
  const launch = () => electron.launch({
    executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
    args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])],
  });
  try {
    app = await launch(); const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: '그림판 이미지 분석', exact: true })).toBeVisible();
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
    const file = join(folder, 'bead-road.png'); writeFileSync(file, Buffer.from(encoded, 'base64'));
    // Test-only native picker response; production still requires the user's selected image.
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
    await page.getByRole('button', { name: '그림판 이미지 분석', exact: true }).click();
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
    await page.getByRole('button', { name: '그림판 이미지 분석', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toBeVisible();
    await page.getByLabel('이미지 결과 1', { exact: true }).selectOption('P'); await confirmed.check();
    await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('image-save-status')).toContainText('새 기록 0개');
    await page.screenshot({ path: 'test-results/image-dashboard.png' });
    await app.close(); app = await launch(); const reopened = await app.firstWindow();
    await expect(reopened.getByTestId('total-results')).toHaveText('8');
    expect((await reopened.evaluate(() => window.analyzer.snapshot())).results[0].outcome).toBe('P');
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});
