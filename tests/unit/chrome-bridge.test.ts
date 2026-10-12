import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { ChromeBridge } from '../../src/main/chrome-bridge';
import { demoProfile } from '../../src/collector/dom';
import type { Observation } from '../../src/shared/types';
const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
let bridge: ChromeBridge, folder: string, port: number, rows: Observation[], sockets: WebSocket[];
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'chrome-bridge-')); rows = []; sockets = [];
  bridge = new ChromeBridge(join(folder, 'auth.json'), () => ({ ...demoProfile, hosts: ['provider.example'] }),
    observed => rows.push(...observed), () => {});
  port = await bridge.listen(0);
});
afterEach(async () => { for (const peer of sockets) peer.terminate(); await bridge.close(); rmSync(folder, { recursive: true, force: true }); });
async function connect(origin = ORIGIN) {
  const peer = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin }); sockets.push(peer); await once(peer, 'open'); return peer;
}
async function pair(peer: WebSocket) {
  const paired = once(peer, 'message'); peer.send(JSON.stringify({ type: 'pair', code: bridge.info().pairingCode }));
  const result = JSON.parse(String((await paired)[0])); expect(result.type).toBe('paired');
  return result.token as string;
}
const observation: Observation = { roomId: 'r', roomName: 'Room', shoeId: 's', round: 1, outcome: 'B', confidence: 1, source: 'dom', historical: false };
describe('authenticated Chrome loopback bridge', () => {
  it('pairs once and classifies first snapshot as history, then new results as live', async () => {
    const peer = await connect(); await pair(peer);
    peer.send(JSON.stringify({ type: 'snapshot', host: 'provider.example', observations: [observation] }));
    await expect.poll(() => rows.length).toBe(1); expect(rows[0]).toMatchObject({ source: 'chrome', historical: true });
    peer.send(JSON.stringify({ type: 'snapshot', host: 'provider.example', observations: [observation, { ...observation, round: 2, outcome: 'P' }] }));
    await expect.poll(() => rows.length).toBe(2); expect(rows[1].historical).toBe(false);
    expect(bridge.info().state).toBe('connected'); expect(bridge.info().pairingCode).toBeNull();
  });
  it('persists pairing and reconnects after restarting the receiver without a new code', async () => {
    const peer = await connect(), token = await pair(peer); await bridge.close();
    bridge = new ChromeBridge(join(folder, 'auth.json'), () => null, () => {}, () => {}); port = await bridge.listen(0);
    expect(bridge.info().paired).toBe(true);
    const again = await connect(); const ready = once(again, 'message'); again.send(JSON.stringify({ type: 'auth', token }));
    expect(JSON.parse(String((await ready)[0])).type).toBe('ready');
  });
  it('rejects arbitrary page origins and credentials from a different extension', async () => {
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin: 'https://provider.example' }); sockets.push(rejected);
    await once(rejected, 'error');
    const token = await pair(await connect()), other = await connect(`chrome-extension://${'b'.repeat(32)}`);
    const closed = once(other, 'close'); other.send(JSON.stringify({ type: 'auth', token })); expect((await closed)[0]).toBe(1008);
  });
  it('rejects unpaired observations and wrong pairing codes', async () => {
    const unpaired = await connect(), closed = once(unpaired, 'close');
    unpaired.send(JSON.stringify({ type: 'snapshot', host: 'provider.example', observations: [observation] }));
    expect((await closed)[0]).toBe(1008); expect(rows).toHaveLength(0);
    const wrong = await connect(), wrongClosed = once(wrong, 'close');
    wrong.send(JSON.stringify({ type: 'pair', code: bridge.info().pairingCode === '000000' ? '111111' : '000000' })); expect((await wrongClosed)[0]).toBe(1008);
  });
  it('does not ingest an unapproved provider or repeat identical snapshots', async () => {
    const peer = await connect(); await pair(peer);
    peer.send(JSON.stringify({ type: 'snapshot', host: 'evil.example', observations: [observation] }));
    peer.send(JSON.stringify({ type: 'snapshot', host: 'provider.example', observations: [observation] }));
    peer.send(JSON.stringify({ type: 'snapshot', host: 'provider.example', observations: [observation] }));
    await expect.poll(() => rows.length).toBe(1);
    expect(rows[0].roomId).toBe('r');
  });
  it('invalidates the old pairing when the user resets it', async () => {
    const token = await pair(await connect()); bridge.reset(); expect(bridge.info().paired).toBe(false);
    const peer = await connect(), closed = once(peer, 'close'); peer.send(JSON.stringify({ type: 'auth', token })); expect((await closed)[0]).toBe(1008);
  });
});
