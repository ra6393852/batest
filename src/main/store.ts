import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { analyze, statistics } from '../analysis/engine';
import { observationsSchema } from '../shared/validation';
import type { Observation, GameResult, Forecast, Pending, Room, Snapshot } from '../shared/types';

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), shoe_id TEXT NOT NULL,
 round INTEGER NOT NULL CHECK(round>0), outcome TEXT NOT NULL CHECK(outcome IN ('B','P','T')),
 confidence REAL NOT NULL, source TEXT NOT NULL, historical INTEGER NOT NULL,
 occurred_at TEXT, recorded_at TEXT NOT NULL, UNIQUE(room_id,shoe_id,round)
);
CREATE TABLE IF NOT EXISTS forecasts (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), shoe_id TEXT NOT NULL,
 target_round INTEGER NOT NULL, cutoff_round INTEGER NOT NULL, horizon INTEGER NOT NULL CHECK(horizon IN (1,2,3,4)),
 method TEXT NOT NULL CHECK(method IN ('A','B','C','D')), probabilities TEXT NOT NULL, pick TEXT NOT NULL,
 sample_size INTEGER NOT NULL, basis TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(target_round>cutoff_round), UNIQUE(room_id,shoe_id,target_round,cutoff_round,method)
);
CREATE TABLE IF NOT EXISTS settlements (
 forecast_id TEXT PRIMARY KEY REFERENCES forecasts(id), result_id TEXT NOT NULL REFERENCES results(id),
 actual TEXT NOT NULL, mark TEXT NOT NULL CHECK(mark IN ('O','X')), scored_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS result_scores (
 result_id TEXT PRIMARY KEY REFERENCES results(id), score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 9), confirmed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
 id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, reason TEXT NOT NULL,
 observed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS result_lookup ON results(room_id,shoe_id,round);
CREATE INDEX IF NOT EXISTS forecast_lookup ON forecasts(room_id,shoe_id,target_round);
CREATE TRIGGER IF NOT EXISTS immutable_forecast_update BEFORE UPDATE ON forecasts BEGIN SELECT RAISE(ABORT,'immutable forecast'); END;
CREATE TRIGGER IF NOT EXISTS immutable_forecast_delete BEFORE DELETE ON forecasts BEGIN SELECT RAISE(ABORT,'immutable forecast'); END;
CREATE TRIGGER IF NOT EXISTS immutable_result_update BEFORE UPDATE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TRIGGER IF NOT EXISTS immutable_result_delete BEFORE DELETE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TRIGGER IF NOT EXISTS immutable_score_update BEFORE UPDATE ON settlements BEGIN SELECT RAISE(ABORT,'immutable score'); END;
CREATE TRIGGER IF NOT EXISTS immutable_score_delete BEFORE DELETE ON settlements BEGIN SELECT RAISE(ABORT,'immutable score'); END;
CREATE TRIGGER IF NOT EXISTS immutable_point_update BEFORE UPDATE ON result_scores BEGIN SELECT RAISE(ABORT,'immutable point'); END;
CREATE TRIGGER IF NOT EXISTS immutable_point_delete BEFORE DELETE ON result_scores BEGIN SELECT RAISE(ABORT,'immutable point'); END;
PRAGMA user_version=2;
`;
export class AnalyzerStore {
  private constructor(private sql: SqlJsStatic, private db: Database, private file: string,
    private clock: () => Date) {}
  static async open(file: string, clock = () => new Date()) {
    const moduleRequire = typeof require === 'function' ? require : createRequire(join(process.cwd(), 'package.json'));
    const sql = await initSqlJs({ locateFile: () => moduleRequire.resolve('sql.js/dist/sql-wasm.wasm') });
    const db = new sql.Database(existsSync(file) ? readFileSync(file) : undefined);
    const version = db.exec('PRAGMA user_version')[0]?.values[0][0] ?? 0;
    if (Number(version) > 2) { db.close(); throw new Error('지원되지 않는 DB 버전입니다.'); }
    if (Number(version) === 1) {
      db.run('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
      try {
        const definition = SCHEMA.match(/CREATE TABLE IF NOT EXISTS forecasts \([\s\S]*?\n\);/)![0];
        db.run(definition.replace('forecasts (', 'forecasts_v2 ('));
        db.run('INSERT INTO forecasts_v2 SELECT * FROM forecasts; DROP TABLE forecasts; ALTER TABLE forecasts_v2 RENAME TO forecasts;');
        db.run(SCHEMA);
        if (db.exec('PRAGMA foreign_key_check').length) throw new Error('DB 관계 검증 실패');
        db.run('COMMIT; PRAGMA foreign_keys=ON');
      } catch (error) { db.run('ROLLBACK'); db.close(); throw error; }
    }
    db.run(SCHEMA);
    const store = new AnalyzerStore(sql, db, file, clock);
    // Backfill newly supported horizons without changing any frozen forecasts.
    store.transaction(() => { for (const row of store.rows('SELECT room_id,shoe_id,MAX(round) AS round FROM results GROUP BY room_id,shoe_id'))
      store.forecast({ roomId: String(row.room_id), shoeId: String(row.shoe_id), round: Number(row.round) }, clock().toISOString()); });
    return store;
  }
  private rows(query: string, params: (string | number | null)[] = []): Record<string, unknown>[] {
    const statement = this.db.prepare(query);
    try { statement.bind(params); const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject()); return rows;
    } finally { statement.free(); }
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`, fd = openSync(temp, 'w', 0o600);
    try { writeFileSync(fd, this.db.export()); fsyncSync(fd); } finally { closeSync(fd); }
    try { renameSync(temp, this.file); } catch (error) { if (existsSync(temp)) unlinkSync(temp); throw error; }
  }
  private transaction<T>(fn: () => T): T {
    const before = this.db.export();
    try { this.db.run('BEGIN IMMEDIATE'); const result = fn(); this.db.run('COMMIT'); this.persist(); return result; }
    catch (error) { this.db.close(); this.db = new this.sql.Database(before); this.db.run('PRAGMA foreign_keys=ON'); throw error; }
  }
  private stage(o: Observation, reason: string, at: string) {
    const key = JSON.stringify([o.roomId, o.shoeId, o.round, o.outcome, ...(o.score === undefined ? [] : [o.score])]);
    this.db.run('INSERT OR IGNORE INTO pending(id,key,payload,reason,observed_at) VALUES(?,?,?,?,?)',
      [randomUUID(), key, JSON.stringify(o), reason, at]);
  }
  ingest(input: Observation[], observedAt?: string) {
    const observations = observationsSchema.parse(input).map(o => ({ ...o,
      ...(o.occurredAt ? { occurredAt: new Date(o.occurredAt).toISOString() } : {}) }));
    if (!observations.length) return;
    const at = this.clock().toISOString();
    const firstSeen = observedAt ? new Date(observedAt).toISOString() : at;
    if (firstSeen > at) throw new Error('관측 시각이 현재보다 미래입니다.');
    this.transaction(() => {
      const latest = new Map<string, Observation>();
      const batchOutcomes = new Map<string, Set<Observation['outcome']>>();
      for (const o of observations) {
        const key = JSON.stringify([o.roomId, o.shoeId, o.round]);
        if (!batchOutcomes.has(key)) batchOutcomes.set(key, new Set());
        batchOutcomes.get(key)!.add(o.outcome);
      }
      // Finish the complete snapshot before forecasting, avoiding leakage from later rows in the batch.
      for (const o of observations.sort((a, b) => a.round - b.round)) {
        this.db.run(`INSERT INTO rooms(id,name,updated_at) VALUES(?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`, [o.roomId, o.roomName, at]);
        if (batchOutcomes.get(JSON.stringify([o.roomId, o.shoeId, o.round]))!.size > 1) {
          this.stage(o, '동일 화면에서 같은 회차의 서로 다른 결과 감지 · 확인 필요', at); continue;
        }
        const existing = this.rows('SELECT id,outcome FROM results WHERE room_id=? AND shoe_id=? AND round=?', [o.roomId, o.shoeId, o.round])[0];
        if (existing) {
          if (existing.outcome !== o.outcome) this.stage(o, '이미 저장된 회차와 결과가 다름 · 자동 덮어쓰기 금지', at);
          else if (o.score !== undefined && o.confidence >= 0.92) this.insertScore(String(existing.id), o, at);
          continue;
        }
        if (o.confidence < 0.92) { this.stage(o, '인식 신뢰도 92% 미만 · 결과 확인 필요', at); continue; }
        if (o.occurredAt && o.occurredAt > at) { this.stage(o, '결과 시각이 현재보다 미래임', at); continue; }
        this.insertResult(o, at, firstSeen);
        const key = JSON.stringify([o.roomId, o.shoeId]);
        if (!latest.has(key) || latest.get(key)!.round < o.round) latest.set(key, o);
      }
      for (const o of latest.values()) this.forecast(o, at);
    });
  }
  private insertResult(o: Observation, at: string, firstSeen: string) {
    const id = randomUUID();
    this.db.run('INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?,?)',
      [id, o.roomId, o.shoeId, o.round, o.outcome, o.confidence, o.source, Number(o.historical), o.occurredAt ?? null, at]);
    this.insertScore(id, o, at);
    // Historical imports never receive credit. Pending results use first-seen time, not confirmation time.
    if (!o.historical) {
      const forecasts = this.rows(`SELECT id,pick,created_at FROM forecasts WHERE room_id=? AND shoe_id=? AND target_round=? AND cutoff_round<?`,
        [o.roomId, o.shoeId, o.round, o.round]);
      for (const f of forecasts) {
        const deadline = o.occurredAt && o.occurredAt < firstSeen ? o.occurredAt : firstSeen;
        if (String(f.created_at) >= deadline) continue;
        this.db.run('INSERT OR IGNORE INTO settlements VALUES(?,?,?,?,?)', [String(f.id), id, o.outcome, f.pick === o.outcome ? 'O' : 'X', at]);
      }
    }
  }
  private insertScore(id: string, o: Observation, at: string) {
    if (o.score === undefined) return;
    const previous = this.rows('SELECT score FROM result_scores WHERE result_id=?', [id])[0];
    if (previous && Number(previous.score) !== o.score) { this.stage(o, '이미 확인한 점수와 다름 · 덮어쓰기 금지', at); return; }
    this.db.run('INSERT OR IGNORE INTO result_scores VALUES(?,?,?)', [id, o.score, at]);
  }
  private forecast(o: Pick<Observation, 'roomId' | 'shoeId' | 'round'>, at: string) {
    const rows = this.rows('SELECT r.round,r.outcome,s.score FROM results r LEFT JOIN result_scores s ON s.result_id=r.id WHERE r.room_id=? AND r.shoe_id=? ORDER BY r.round', [o.roomId, o.shoeId]);
    if (Number(rows.at(-1)?.round) !== o.round) return;
    // A gap or a pending next result invalidates the observed cutoff; wait for a contiguous tail.
    let start = rows.length - 1;
    while (start > 0 && Number(rows[start].round) === Number(rows[start - 1].round) + 1) start--;
    const tail = rows.slice(start).map(r => r.outcome as Observation['outcome']);
    const tailScores = rows.slice(start).map(r => r.score == null ? null : Number(r.score));
    const corpus: Observation['outcome'][][] = [];
    const scoreCorpus: Array<Array<number | null>> = [];
    let lastShoe: unknown, lastRound = 0;
    for (const row of this.rows('SELECT r.shoe_id,r.round,r.outcome,s.score FROM results r LEFT JOIN result_scores s ON s.result_id=r.id WHERE r.room_id=? ORDER BY r.shoe_id,r.round', [o.roomId])) {
      if (row.shoe_id !== lastShoe || Number(row.round) !== lastRound + 1) { corpus.push([]); scoreCorpus.push([]); }
      corpus.at(-1)!.push(row.outcome as Observation['outcome']);
      scoreCorpus.at(-1)!.push(row.score == null ? null : Number(row.score));
      lastShoe = row.shoe_id; lastRound = Number(row.round);
    }
    for (const horizon of [1, 2, 3, 4] as const) {
      const models = analyze(tail, corpus, horizon, tailScores, scoreCorpus);
      const target = o.round + horizon;
      const knownPending = this.rows("SELECT payload FROM pending WHERE status='pending'").some(p => {
        const v = JSON.parse(String(p.payload)) as Observation;
        return v.roomId === o.roomId && v.shoeId === o.shoeId && v.round <= target && v.round > o.round;
      });
      if (knownPending) continue;
      for (const model of models) {
        // Every horizon trains on observed historical targets, never predicted branches.
        this.db.run('INSERT OR IGNORE INTO forecasts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          [randomUUID(), o.roomId, o.shoeId, target, o.round, horizon, model.method, JSON.stringify(model.probabilities),
            model.pick, model.sampleSize, model.basis, at]);
      }
    }
  }
  confirm(id: string, accept: boolean) {
    const at = this.clock().toISOString();
    this.transaction(() => {
      const row = this.rows("SELECT * FROM pending WHERE id=? AND status='pending'", [id])[0];
      if (!row) throw new Error('이미 처리되었거나 없는 확인 항목입니다.');
      if (accept) {
        const o = observationsSchema.parse([JSON.parse(String(row.payload))])[0];
        if (o.occurredAt && o.occurredAt > at) throw new Error('미래 시각의 결과는 확정할 수 없습니다.');
        if (this.rows('SELECT id FROM results WHERE room_id=? AND shoe_id=? AND round=?', [o.roomId, o.shoeId, o.round]).length)
          throw new Error('기존 결과가 있는 회차는 변경할 수 없습니다. 충돌 항목을 거절하세요.');
        this.insertResult(o, at, String(row.observed_at));
        this.db.run("UPDATE pending SET status='accepted' WHERE id=?", [id]);
        if (!o.historical) this.forecast(o, at);
      } else this.db.run("UPDATE pending SET status='rejected' WHERE id=?", [id]);
    });
  }
  snapshot(roomId?: string, shoeId?: string): Snapshot {
    const rooms: Room[] = this.rows('SELECT * FROM rooms ORDER BY updated_at DESC,id').map(r => ({
      id: String(r.id), name: String(r.name), updatedAt: String(r.updated_at),
      shoes: this.rows('SELECT shoe_id,MAX(recorded_at) AS last FROM results WHERE room_id=? GROUP BY shoe_id ORDER BY last DESC,shoe_id', [String(r.id)]).map(s => String(s.shoe_id)),
    }));
    const room = rooms.find(r => r.id === roomId) ?? rooms[0];
    const selectedShoe = shoeId && room?.shoes.includes(shoeId) ? shoeId : room?.shoes[0];
    const results: GameResult[] = room && selectedShoe ? this.rows('SELECT r.*,s.score FROM results r LEFT JOIN result_scores s ON s.result_id=r.id WHERE room_id=? AND shoe_id=? ORDER BY round', [room.id, selectedShoe]).map(r => ({
      id: String(r.id), roomId: String(r.room_id), roomName: room.name, shoeId: String(r.shoe_id), round: Number(r.round),
      outcome: r.outcome as Observation['outcome'], confidence: Number(r.confidence), source: r.source as Observation['source'],
      historical: Boolean(r.historical), recordedAt: String(r.recorded_at), occurredAt: r.occurred_at ? String(r.occurred_at) : undefined, ...(r.score != null ? { score: Number(r.score) } : {}),
    })) : [];
    const forecasts: Forecast[] = room && selectedShoe ? this.rows(`SELECT f.*,s.actual,s.mark FROM forecasts f
      LEFT JOIN settlements s ON s.forecast_id=f.id WHERE f.room_id=? AND f.shoe_id=? ORDER BY f.target_round DESC,f.horizon,f.method`, [room.id, selectedShoe]).map(r => ({
      id: String(r.id), roomId: String(r.room_id), shoeId: String(r.shoe_id), targetRound: Number(r.target_round), cutoffRound: Number(r.cutoff_round),
      horizon: Number(r.horizon) as Forecast['horizon'], method: r.method as Forecast['method'], probabilities: JSON.parse(String(r.probabilities)), pick: r.pick as Forecast['pick'],
      sampleSize: Number(r.sample_size), basis: String(r.basis), createdAt: String(r.created_at), actual: r.actual ? r.actual as Forecast['actual'] : undefined,
      mark: r.mark ? r.mark as Forecast['mark'] : undefined,
    })) : [];
    const pending: Pending[] = this.rows("SELECT * FROM pending WHERE status='pending' ORDER BY observed_at").map(r => ({
      ...JSON.parse(String(r.payload)), id: String(r.id), reason: String(r.reason), observedAt: String(r.observed_at),
    }));
    return { rooms, roomId: room?.id ?? null, shoeId: selectedShoe ?? null, results, forecasts, pending, stats: statistics(results.map(r => r.outcome), forecasts, results.map(r => r.round)) };
  }
  csv(roomId: string, shoeId: string) {
    const snapshot = this.snapshot(roomId, shoeId);
    if (snapshot.roomId !== roomId || snapshot.shoeId !== shoeId) throw new Error('방 또는 슈가 없습니다.');
    // Excel formula injection prevention also applies to user-controlled room names and shoe identifiers.
    const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+@\-\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`; };
    const header = ['kind', 'room', 'shoe', 'round', 'outcome', 'method', 'pick', 'B', 'P', 'T', 'mark', 'horizon', 'cutoff', 'timestamp', 'source', 'historical', 'sample_size', 'score'];
    const rows: unknown[][] = snapshot.results.map(r => ['result', r.roomName, r.shoeId, r.round, r.outcome, '', '', '', '', '', '', '', '', r.occurredAt ?? r.recordedAt, r.source, r.historical, '', r.score ?? '']);
    rows.push(...snapshot.forecasts.map(f => ['forecast', snapshot.rooms.find(r => r.id === roomId)!.name, shoeId, f.targetRound, f.actual ?? '', f.method, f.pick, f.probabilities.B, f.probabilities.P, f.probabilities.T, f.mark ?? '', f.horizon, f.cutoffRound, f.createdAt, '', '', f.sampleSize, '']));
    return '\uFEFF' + [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  }
  close() { this.db.close(); }
}
