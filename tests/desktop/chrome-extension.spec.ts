import { chromium, test, expect, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ChromeBridge } from '../../src/main/chrome-bridge';
import { AnalyzerStore } from '../../src/main/store';
import { demoProfile } from '../../src/collector/dom';
import type { AdapterProfile } from '../../src/shared/types';

test('Chrome extension pairs, collects read-only results and reconnects without reloading Chrome', async () => {
  test.setTimeout(60000);
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-extension-'));
  const extension = join(folder, 'extension');
  cpSync(process.env.DESKTOP_TEST_EXECUTABLE ? join(dirname(process.env.DESKTOP_TEST_EXECUTABLE), 'resources/chrome-extension') : 'dist/extension', extension, { recursive: true });
  // This fixture alone grants loopback page access; production prompts only for selected HTTPS game domains.
  const manifestFile = join(extension, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*', 'https://lobby.example/*', 'https://game.example/*', 'https://frame.example/*');
  manifest.permissions.push('webNavigation'); writeFileSync(manifestFile, JSON.stringify(manifest));
  const html = readFileSync('tests/fixtures/table.html');
  const site = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
  site.listen(0, '127.0.0.1'); await once(site, 'listening');
  const port = (site.address() as { port: number }).port;
  const store = await AnalyzerStore.open(join(folder, 'records.sqlite'));
  let profile: AdapterProfile | null = { ...demoProfile, hosts: ['127.0.0.1'] };
  const makeBridge = () => new ChromeBridge(join(folder, 'auth.json'), () => profile, rows => store.ingest(rows), () => {});
  let bridge = makeBridge(); await bridge.listen(); let context: BrowserContext | undefined;
  try {
    const executable = process.env.CHROME_TEST_EXECUTABLE ?? (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    context = await chromium.launchPersistentContext(join(folder, 'chrome-data'), {
      executablePath: executable, channel: 'chromium', headless: process.platform === 'linux',
      timeout: 15000,
      ignoreDefaultArgs: ['--disable-extensions'],
      env: { ...process.env, XDG_CACHE_HOME: join(folder, 'cache'), XDG_CONFIG_HOME: join(folder, 'config'), MESA_SHADER_CACHE_DIR: join(folder, 'mesa') },
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
    // A popup with no extension toolbar and a cross-origin game iframe are discoverable from the app's panel.
    // Routes are local fixture responses; no real provider login/session is contacted.
    profile = null; bridge.refreshProfile();
    await context.route('https://lobby.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Local fixture lobby</p>' }));
    await context.route('https://game.example/**', route => route.fulfill({ contentType: 'text/html', body: html.toString().replaceAll('demo-alpha', 'image-popup').replace('</body>', '<iframe src="https://frame.example/table"></iframe></body>') }));
    await context.route('https://frame.example/**', route => route.fulfill({ contentType: 'text/html', body: html.toString().replaceAll('demo-alpha', 'image-frame') }));
    await context.route('https://unpermitted.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Game domain awaiting permission</p>' }));
    const lobby = await context.newPage(); await lobby.goto('https://lobby.example/');
    // Create real Chrome popup windows explicitly; discovery must work without a toolbar or an activeTab grant.
    await worker.evaluate(async () => {
      await chrome.windows.create({ url: 'https://game.example/table', type: 'popup', width: 800, height: 600 });
      await chrome.windows.create({ url: 'https://unpermitted.example/table', type: 'popup', width: 800, height: 600 });
    });
    expect(bridge.openPanel()).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url === chrome.runtime.getURL('popup.html')).length), { timeout: 10000 }).toBe(2);
    await popup.getByRole('button', { name: '열린 게임 창 확인', exact: true }).click();
    await expect.poll(() => bridge.info().targets.some(target => target.host === 'game.example' && target.kind === 'window'), { timeout: 10000 }).toBe(true);
    await expect.poll(() => bridge.info().targets.some(target => target.host === 'frame.example' && target.kind === 'frame')).toBe(true);
    expect(bridge.info().targets.find(target => target.host === 'unpermitted.example')?.permission).toBe(false);
    expect(bridge.info().targets.filter(target => ['game.example', 'frame.example'].includes(target.host)).every(target => target.recognition === 'unconfigured')).toBe(true);
    expect(store.snapshot().rooms).toHaveLength(1);
    profile = { ...demoProfile, hosts: ['game.example', 'frame.example'] }; bridge.refreshProfile();
    await expect.poll(() => store.snapshot('image-popup', 'demo-shoe-1').roomId, { timeout: 10000 }).toBe('image-popup');
    await expect.poll(() => store.snapshot('image-frame', 'demo-shoe-1').roomId).toBe('image-frame');
    expect(store.snapshot('image-frame', 'demo-shoe-1').results).toHaveLength(6);
    await expect.poll(() => bridge.info().targets.some(target => target.host === 'frame.example' && target.recognition === 'observed')).toBe(true);
  } finally {
    await context?.close(); await bridge.close(); store.close();
    await new Promise<void>(resolve => site.close(() => resolve())); rmSync(folder, { recursive: true, force: true });
  }
});
