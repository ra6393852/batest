import { chromium, test, expect, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChromeBridge } from '../../src/main/chrome-bridge';
import { AnalyzerStore } from '../../src/main/store';
import { demoProfile } from '../../src/collector/dom';

test('Chrome extension pairs, collects read-only results and reconnects without reloading Chrome', async () => {
  test.setTimeout(60000);
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-extension-'));
  const extension = join(folder, 'extension'); cpSync('dist/extension', extension, { recursive: true });
  // This fixture alone grants loopback page access; production prompts only for selected HTTPS game domains.
  const manifestFile = join(extension, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*'); writeFileSync(manifestFile, JSON.stringify(manifest));
  const html = readFileSync('tests/fixtures/table.html');
  const site = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
  site.listen(0, '127.0.0.1'); await once(site, 'listening');
  const port = (site.address() as { port: number }).port;
  const store = await AnalyzerStore.open(join(folder, 'records.sqlite'));
  const makeBridge = () => new ChromeBridge(join(folder, 'auth.json'), () => ({ ...demoProfile, hosts: ['127.0.0.1'] }), rows => store.ingest(rows), () => {});
  let bridge = makeBridge(); await bridge.listen(); let context: BrowserContext | undefined;
  try {
    const executable = process.env.CHROME_TEST_EXECUTABLE ?? (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    context = await chromium.launchPersistentContext(join(folder, 'chrome-data'), {
      executablePath: executable, channel: 'chromium', headless: false,
      timeout: 15000,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('link', { name: '프로그램 실행' })).toHaveAttribute('href', 'baccarat-analyzer://connect');
    await popup.locator('#code').fill(bridge.info().pairingCode!);
    await popup.getByRole('button', { name: '프로그램과 연결' }).click();
    await expect.poll(() => bridge.info().state).toBe('connected');
    const game = await context.newPage(); await game.goto(`http://127.0.0.1:${port}`);
    // Simulates the one-time host permission grant for this local test, retaining actual isolated content-script execution.
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      for (const tab of tabs) if (tab.id !== undefined) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    });
    await expect.poll(() => store.snapshot().results.length).toBe(6);
    await game.getByRole('button', { name: '새 결과 B', exact: true }).click();
    await expect.poll(() => store.snapshot().results.length).toBe(7);
    expect(store.snapshot().results.at(-1)?.source).toBe('chrome');
    expect(store.snapshot().stats.comparisons).toBe(1);
    await bridge.close();
    await game.getByRole('button', { name: '새 결과 P', exact: true }).click();
    bridge = makeBridge(); await bridge.listen();
    await expect.poll(() => bridge.info().state, { timeout: 15000 }).toBe('connected');
    await expect.poll(() => store.snapshot().results.length, { timeout: 15000 }).toBe(8);
    expect(bridge.info().pairingCode).toBeNull();
    // Recovered results from while the app was closed are history, not retrospectively scored predictions.
    expect(store.snapshot().results.at(-1)?.historical).toBe(true);
    expect(store.snapshot().stats.comparisons).toBe(1);
    expect(await game.evaluate(() => typeof (window as unknown as { analyzer?: unknown }).analyzer)).toBe('undefined');
  } finally {
    await context?.close(); await bridge.close(); store.close();
    await new Promise<void>(resolve => site.close(() => resolve())); rmSync(folder, { recursive: true, force: true });
  }
});
