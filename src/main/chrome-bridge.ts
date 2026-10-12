import { createServer, type Server } from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { observationsSchema } from '../shared/validation';
import { ObservationTracker } from '../collector/dom';
import type { AdapterProfile, ChromeConnection, Observation } from '../shared/types';

export const BRIDGE_PORT = 38741;
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const credentialsSchema = z.object({ origin: z.string().regex(extensionOrigin), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pair'), code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ type: z.literal('auth'), token: z.string().max(64) }).strict(),
  z.object({ type: z.literal('snapshot'), host: z.string().max(253), observations: observationsSchema }).strict(),
  z.object({ type: z.literal('presence'), tabs: z.number().int().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
function secretEquals(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class ChromeBridge {
  private server: Server | undefined;
  private sockets = new WebSocketServer({ noServer: true, maxPayload: 512_000, perMessageDeflate: false });
  private peers = new Set<WebSocket>();
  private credentials: { origin: string; token: string } | null = null;
  private code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  private attempts = 0;
  private attemptWindow = Date.now();
  private codeAt = Date.now();
  private state: ChromeConnection = { state: 'waiting', paired: false, pairingCode: null, tabs: 0, message: 'Chrome 확장 연결 대기' };
  constructor(private file: string, private profile: () => AdapterProfile | null,
    private ingest: (observations: Observation[]) => void, private onChange: () => void,
    private onCollection: (message: string, collecting: boolean) => void = () => {}) {
    if (existsSync(file)) {
      try { this.credentials = credentialsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { this.credentials = null; }
    }
  }
  info(): ChromeConnection {
    if (Date.now() - this.codeAt > 600_000) { this.code = String(randomInt(0, 1_000_000)).padStart(6, '0'); this.codeAt = Date.now(); }
    return { ...this.state, paired: Boolean(this.credentials), pairingCode: this.credentials ? null : this.code };
  }
  async listen(port = BRIDGE_PORT) {
    this.server = createServer((_request, response) => { response.writeHead(404); response.end(); });
    this.server.on('upgrade', (request, socket, head) => {
      const origin = request.headers.origin ?? '';
      const address = this.server?.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      if (!extensionOrigin.test(origin) || request.url !== '/bridge' || request.headers.host !== `127.0.0.1:${actualPort}` || this.sockets.clients.size >= 4) {
        socket.destroy(); return;
      }
      this.sockets.handleUpgrade(request, socket, head, peer => this.accept(peer, origin));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => { this.server!.removeListener('error', reject); resolve(); });
    });
    this.server.on('error', () => { this.state = { ...this.state, state: 'error', message: 'Chrome 연결 포트를 사용할 수 없습니다.' }; this.onChange(); });
    return (this.server.address() as { port: number }).port;
  }
  private accept(peer: WebSocket, origin: string) {
    let authorized = false, tracker = new ObservationTracker(), currentProfile = this.profile()?.id;
    let count = 0, rateAt = Date.now();
    const deadline = setTimeout(() => { if (!authorized) peer.close(1008, 'authentication required'); }, 10_000);
    const send = (data: unknown) => { if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify(data)); };
    peer.on('error', () => {});
    peer.on('message', raw => {
      try {
        if (Date.now() - rateAt > 1000) { count = 0; rateAt = Date.now(); }
        if (++count > 20) { peer.close(1008, 'rate limit'); return; }
        const message = messageSchema.parse(JSON.parse(raw.toString()));
        if (message.type === 'pair' || message.type === 'auth') {
          if (authorized) { peer.close(1008, 'already authenticated'); return; }
          if (message.type === 'pair') {
            if (Date.now() - this.attemptWindow > 60_000) { this.attemptWindow = Date.now(); this.attempts = 0; }
            this.info();
            if (++this.attempts > 5 || this.credentials || !secretEquals(message.code, this.code)) { peer.close(1008, 'pairing failed'); return; }
            const credentials = { origin, token: randomBytes(32).toString('hex') };
            mkdirSync(dirname(this.file), { recursive: true });
            const temp = `${this.file}.tmp`; writeFileSync(temp, JSON.stringify(credentials), { mode: 0o600 }); renameSync(temp, this.file);
            this.credentials = credentials;
            send({ type: 'paired', token: credentials.token });
          } else if (!this.credentials || origin !== this.credentials.origin || !secretEquals(message.token, this.credentials.token)) {
            peer.close(1008, 'authentication failed'); return;
          }
          authorized = true; clearTimeout(deadline);
          for (const previous of this.peers) previous.close(1000, 'reconnected');
          this.peers.clear(); this.peers.add(peer);
          this.state = { state: 'connected', paired: true, pairingCode: null, tabs: 0, message: 'Chrome 연결됨 · 열린 바카라 탭 확인 중' };
          send({ type: 'ready', profile: this.profile() }); this.onChange(); return;
        }
        if (!authorized) { peer.close(1008, 'authentication required'); return; }
        if (message.type === 'ping') { send({ type: 'pong' }); return; }
        if (message.type === 'presence') {
          this.state.tabs = message.tabs;
          this.state.message = message.tabs ? `Chrome 연결됨 · 허용된 탭 ${message.tabs}개${this.profile() ? '' : ' · 결과 인식 프로필 미설정'}` : 'Chrome 연결됨 · 허용된 바카라 탭을 열어주세요';
          this.onChange(); return;
        }
        const profile = this.profile();
        if (!profile || !profile.hosts.includes(message.host)) {
          this.onCollection('Chrome 연결됨 · 해당 화면의 결과 인식 프로필 미설정', false); return;
        }
        if (!message.observations.length) { this.onCollection('Chrome 연결됨 · 방·슈·회차·결과를 찾지 못함 · 실제 화면 인식 미검증', false); return; }
        if (currentProfile !== profile.id) { tracker = new ObservationTracker(); currentProfile = profile.id; }
        const fresh = tracker.filter(message.observations.map(o => ({ ...o, source: 'chrome' as const })));
        if (fresh.length) { try { this.ingest(fresh); } catch (error) { tracker = new ObservationTracker(); throw error; } }
        this.onCollection(fresh.length ? `Chrome에서 ${fresh.length}개 새 결과 감지` : 'Chrome 연결됨 · 새 결과 대기', true);
      } catch {
        // Never echo payloads, codes, tokens, page URLs, or session details into logs.
        send({ type: 'error', message: '결과 형식 또는 저장 상태를 확인하세요.' });
      }
    });
    peer.on('close', () => {
      clearTimeout(deadline);
      if (!this.peers.delete(peer)) return;
      if (!this.peers.size) { this.state = { ...this.state, state: 'waiting', tabs: 0, message: 'Chrome 재연결 대기 · 확장은 자동으로 다시 연결합니다.' }; this.onChange(); }
    });
  }
  refreshProfile() {
    for (const peer of this.peers) if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'ready', profile: this.profile() }));
  }
  reset() {
    this.credentials = null; this.code = String(randomInt(0, 1_000_000)).padStart(6, '0'); this.codeAt = Date.now(); this.attempts = 0;
    mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, '{}', { mode: 0o600 });
    for (const peer of this.peers) peer.close(1000, 'pair again');
    this.state = { state: 'waiting', paired: false, pairingCode: this.code, tabs: 0, message: '확장에서 새 연결 코드를 입력하세요.' }; this.onChange();
  }
  async close() {
    for (const peer of this.sockets.clients) peer.terminate();
    await new Promise<void>(resolve => this.sockets.close(() => resolve()));
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }
}
