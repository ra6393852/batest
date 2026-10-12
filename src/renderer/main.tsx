import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { methods, type AnalyzerAPI, type CollectorStatus, type ChromeConnection, type Snapshot, type Outcome } from '../shared/types';
import { BASE } from '../analysis/engine';
import './styles.css';
declare global { interface Window { analyzer: AnalyzerAPI } }
const labels: Record<Outcome, string> = { B: '뱅커', P: '플레이어', T: '타이' };
const methodNames = { A: '기본 이론값', B: '최근 흐름', C: '연속 패턴', D: '전체 패턴' };
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(2)}%`;
const date = (value: string) => new Date(value).toLocaleString('ko-KR');
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selectedRoom, setRoom] = useState<string>(), [selectedShoe, setShoe] = useState<string>();
  const [status, setStatus] = useState<CollectorStatus>({ state: 'idle', message: 'Chrome에서 로그인·에볼루션 접속 후 확장의 프로그램 실행을 누르세요.', history: 'unknown' });
  const [chrome, setChrome] = useState<ChromeConnection>(), [extensionFolder, setExtensionFolder] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const slot = useRef<HTMLDivElement>(null), request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    try { const data = await window.analyzer.snapshot(selectedRoom, selectedShoe); if (id === request.current) setSnapshot(data); }
    catch { setError('기록을 불러오지 못했습니다.'); }
  }, [selectedRoom, selectedShoe]);
  useEffect(() => { void load(); return window.analyzer.onChange(() => { void load(); }); }, [load]);
  useEffect(() => window.analyzer.onStatus(setStatus), []);
  useEffect(() => {
    const update = () => { void window.analyzer.chromeInfo().then(setChrome); }; update();
    const unsubscribe = window.analyzer.onChrome(setChrome); const timer = setInterval(update, 5000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, []);
  const bounds = useCallback(() => {
    const box = slot.current?.getBoundingClientRect(); if (!box || !browserOpen) return;
    window.analyzer.setBrowserBounds({ x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width), height: Math.floor(box.height) });
  }, [browserOpen]);
  useEffect(() => { if (!slot.current) return; const resize = new ResizeObserver(bounds); resize.observe(slot.current); window.addEventListener('resize', bounds); bounds();
    return () => { resize.disconnect(); window.removeEventListener('resize', bounds); }; }, [bounds]);
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await load(); } catch { setError('작업 실패 · 입력 형식이나 기존 회차 충돌을 확인하세요.'); } finally { setBusy(false); } }
  async function open(mode: 'site' | 'demo') { setBrowserOpen(true); await window.analyzer.open(mode); requestAnimationFrame(bounds); }
  const s = snapshot?.stats;
  const latest = snapshot?.results.at(-1)?.round;
  const next = snapshot?.forecasts.filter(f => f.horizon === 1 && f.targetRound === (latest ?? 0) + 1) ?? [];
  return <div className="app">
    <header><div><span className="eyebrow">READ-ONLY ANALYTICS</span><h1>Baccarat <span>Live Analyzer</span></h1></div><span className="safety">자동 베팅 없음</span></header>
    <nav>
      <button disabled={busy} onClick={() => void action(async () => setExtensionFolder(await window.analyzer.chromeExtensionFolder()))}>Chrome 확장 설치 폴더</button>
      <button className="secondary" disabled={busy} onClick={() => void action(() => open('demo'))}>테스트 화면</button>
      <button className="secondary" disabled={busy} onClick={() => void action(() => window.analyzer.importProfile())}>허용된 프로필 가져오기</button>
      {browserOpen && <button className="quiet" onClick={() => void action(async () => { await window.analyzer.closeBrowser(); setBrowserOpen(false); })}>브라우저 닫기</button>}
      <span className={`status ${status.state}`} data-testid="collector-status">{status.message}</span>
    </nav>
    {error && <div role="alert" className="error">{error}</div>}
    <main>
      <div className="left-pane">
        <section className="browser-panel"><div className="panel-title"><h2>{browserOpen ? '테스트 게임 화면' : 'Chrome 연결'}</h2><span>사이트는 Chrome에서 직접 이용</span></div>
          <div className="browser-slot" ref={slot}>{!browserOpen && <div className="chrome-panel"><div className="empty-symbol">◉</div>
            <h3>{chrome?.state === 'connected' ? 'Chrome에 연결되었습니다' : 'Chrome 확장에서 프로그램 실행을 누르세요'}</h3>
            <p data-testid="chrome-status">{chrome?.message ?? '연결 상태 확인 중'}</p>
            {chrome?.pairingCode && <div className="pairing"><span>처음 한 번 확장에 입력할 연결 코드</span><strong data-testid="pairing-code">{chrome.pairingCode}</strong></div>}
            <ol><li>위의 확장 설치 폴더를 엽니다.</li><li>Chrome의 <b>chrome://extensions</b>에서 개발자 모드를 켜고 <b>압축해제된 확장 프로그램 로드</b>로 해당 폴더를 선택합니다.</li><li>바카라 탭에서 확장 아이콘을 눌러 연결 코드와 <b>현재 바카라 탭 읽기 허용</b>을 처음 한 번 설정합니다.</li></ol>
            {extensionFolder && <p className="folder-path">확장 폴더: {extensionFolder}</p>}
            <p className="note">다음부터는 Chrome 로그인 → 에볼루션 방 입장 → 확장 아이콘의 프로그램 실행으로 자동 재연결합니다. 실제 방·회차·그림장 결과 인식은 허용된 프로필 검증이 필요합니다. 연결됨 표시만으로 자동 수집이 검증된 것은 아닙니다.</p>
            {chrome?.paired && <button className="quiet" onClick={() => void action(() => window.analyzer.chromeReset())}>Chrome 연결 재설정</button>}
          </div>}</div>
        </section>
        <section className="forecast-panel"><div className="panel-title"><h2>다음 회차 추정</h2><span>{latest ? `${latest + 1}회차 · 기록 범위 ${latest}회차까지` : '결과 기록 대기'}</span></div>
          <p className="note">A는 8덱 이론값, B/C/D는 과거 결과의 평활 추정입니다. 카드 구성과 실제 다음 판의 확률은 알 수 없습니다. 표본이 많아도 예측력이 보장되지는 않습니다.</p>
          <div className="models">{methods.map(method => {
            const f = next.find(f => f.method === method), probabilities = f?.probabilities ?? (method === 'A' ? BASE : null);
            return <article key={method}><div className="model-heading"><b>{method}</b><span>{methodNames[method]}</span>{f && <strong className={f.pick}>{f.pick}</strong>}</div>
              <div className="probabilities">{(['B', 'P', 'T'] as Outcome[]).map(o => <div key={o}><span className={o}>{o}</span><strong>{probabilities ? percent(probabilities[o]) : '—'}</strong></div>)}</div>
              <p>{f ? f.basis : method === 'A' ? 'B 45.86% · P 44.62% · T 9.52%' : '기록 후 계산'}</p>
              <small>{f ? `표본 ${f.sampleSize}개${method !== 'A' && f.sampleSize < 30 ? ' · 표본 부족' : ''} · ${date(f.createdAt)}` : '저장된 사전 예측 없음'}</small>
            </article>;
          })}</div>
        </section>
      </div>
      <div className="right-pane">
        <section><div className="panel-title"><h2>방별 통계</h2><button className="quiet" disabled={!snapshot?.roomId || !snapshot?.shoeId || busy} onClick={() => void action(async () => { if (snapshot?.roomId && snapshot.shoeId) await window.analyzer.exportCSV(snapshot.roomId, snapshot.shoeId); })}>CSV 내보내기</button></div>
          <div className="selectors"><label>방<select aria-label="방" value={snapshot?.roomId ?? ''} onChange={e => { setRoom(e.target.value); setShoe(undefined); }}><option value="" disabled>방 기록 없음</option>{snapshot?.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>슈<select aria-label="슈" value={snapshot?.shoeId ?? ''} onChange={e => setShoe(e.target.value)}><option value="" disabled>슈 기록 없음</option>{snapshot?.rooms.find(r => r.id === snapshot.roomId)?.shoes.map(shoe => <option key={shoe}>{shoe}</option>)}</select></label></div>
          <div className="metrics"><div><span>전체 결과</span><b data-testid="total-results">{s?.total ?? 0}</b></div>{(['B', 'P', 'T'] as Outcome[]).map(o => <div key={o}><span className={o}>{labels[o]}</span><b>{s?.counts[o] ?? 0}</b><small>{percent(s?.ratios[o] ?? 0)}</small></div>)}</div>
          <div className="streaks"><span>현재 {s?.current.outcome ?? '—'} {s?.current.length ?? 0}연속</span><span>최장 B {s?.longest.B ?? 0} / P {s?.longest.P ?? 0}</span><span>전환 {s?.transitions ?? 0}회</span></div>
          <p className="note">통계는 선택한 방·슈 기준입니다. 타이는 B/P 연속을 끊지 않습니다. 첫 입장에서는 현재 화면에 보이는 기록만 복원하며 전체 이력 복원은 미검증입니다.</p>
        </section>
        <section><div className="panel-title"><h2>방식별 성과</h2><span>동일 회차 {s?.comparisons ?? 0}개 비교</span></div>
          <div className="table-scroll"><table><thead><tr><th>방식</th><th>전체 O/X</th><th>타이 제외</th><th>최근 10/30/100</th><th>Brier ↓</th><th>로그 손실 ↓</th></tr></thead><tbody>{methods.map(m => {
            const a = s?.accuracy[m]; return <tr key={m}><th>{m}</th><td>{percent(a?.all.rate ?? null)}<small>{a?.all.correct ?? 0}/{a?.all.count ?? 0}</small></td><td>{percent(a?.all.noTieRate ?? null)}<small>{a?.all.noTieCorrect ?? 0}/{a?.all.noTieCount ?? 0}</small></td><td className="compact">{[a?.last10, a?.last30, a?.last100].map((v, i) => <span key={i}>{percent(v?.rate ?? null)} ({v?.count ?? 0})</span>)}</td><td>{a?.all.brier?.toFixed(3) ?? '—'}</td><td>{a?.all.logLoss?.toFixed(3) ?? '—'}</td></tr>;
          })}</tbody></table></div><p className="note">즉시 다음 회차 예측(horizon 1)만 공통 회차로 비교합니다. 실제 T도 O/X로 채점합니다. 타이 제외는 실제 결과 T인 회차만 제외합니다. 확률 오차는 낮을수록 좋습니다. 표본이 적으면 우수 방식을 단정하지 않습니다.</p>
        </section>
        {snapshot && snapshot.pending.length > 0 && <section className="pending"><h2>확인 대기 {snapshot.pending.length}개</h2>{snapshot.pending.map(p => <div key={p.id}><p>{p.roomName} / {p.shoeId} / {p.round}회차 <b className={p.outcome}>{p.outcome}</b> · {percent(p.confidence)}</p><small>{p.reason}</small><div><button disabled={busy} onClick={() => void action(() => window.analyzer.confirm(p.id, true))}>결과 확인</button><button className="secondary" disabled={busy} onClick={() => void action(() => window.analyzer.confirm(p.id, false))}>거절</button></div></div>)}</section>}
        <section><div className="panel-title"><h2>결과 그림장 · 비드로드</h2><span>위→아래 6행, 왼쪽→오른쪽</span></div><div className="bead-road" data-testid="bead-road">{snapshot?.results.map(r => <span key={r.id} className={`bead ${r.outcome}`} title={`${r.round}회차 ${r.outcome} · ${r.historical ? '기존 화면 기록' : '실시간 수집'}`}>{r.outcome}</span>)}</div></section>
        <section><h2>예측 O/X 이력</h2><div className="table-scroll history"><table><thead><tr><th>목표</th><th>방식</th><th>추정</th><th>실제</th><th>채점</th><th>사전 기록</th></tr></thead><tbody>{snapshot?.forecasts.slice(0, 160).map(f => <tr key={f.id}><td>{f.targetRound}</td><td>{f.method}</td><td className={f.pick}>{f.pick}</td><td>{f.actual ?? '대기'}</td><td>{f.mark ?? '—'}</td><td><small>{f.cutoffRound}회차 기준 · {f.horizon}회차 앞<br/>{date(f.createdAt)}</small></td></tr>)}</tbody></table></div><p className="note">최근 예측 160개 표시 · 전체 기록은 CSV에 포함합니다. 기존 결과의 사후 채점은 하지 않습니다.</p></section>
        <section><h2>결과 기록</h2><div className="table-scroll history"><table><thead><tr><th>회차</th><th>결과</th><th>시각</th><th>수집</th></tr></thead><tbody>{snapshot?.results.slice(-100).reverse().map(r => <tr key={r.id}><td>{r.round}</td><td className={r.outcome}>{r.outcome}</td><td>{date(r.occurredAt ?? r.recordedAt)}{!r.occurredAt && <small>화면에서 관측한 시각</small>}</td><td>{r.source} · {r.historical ? '기존' : '신규'}</td></tr>)}</tbody></table></div></section>
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
