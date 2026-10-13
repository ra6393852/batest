import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { methods, type AnalyzerAPI, type Snapshot, type Outcome, type ImageReview, type ImagePreview, type RecognitionDiagnostics } from '../shared/types';
import { BASE } from '../analysis/engine';
import { expandImageSequence } from '../shared/image-sequence';
import './styles.css';
declare global { interface Window { analyzer: AnalyzerAPI } }
const labels: Record<Outcome, string> = { B: '뱅커', P: '플레이어', T: '타이' };
const methodNames = { A: '기본 이론값', B: '최근 흐름', C: '연속 패턴', D: '전체 패턴' };
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(2)}%`;
const date = (value: string) => new Date(value).toLocaleString('ko-KR');
function RecognitionDetails({ value }: { value?: RecognitionDiagnostics }) {
  if (!value) return null;
  return <p className="note" data-testid="recognition-diagnostics">인식 점검: {value.width}×{value.height} · 색 픽셀 {value.coloredPixels}개 · 격자 후보 {value.gridCandidates}개 · 원 후보 {value.circleCandidates}개 · 원 기반 6행 후보 {value.circleGrids}개<br/>{value.detail}</p>;
}
function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1.5), [width, setWidth] = useState<number>();
  return <div className="image-viewer">
    <div className="image-zoom" role="group" aria-label="이미지 확대 보기">
      <button className={zoom === 1 ? '' : 'secondary'} aria-pressed={zoom === 1} onClick={() => setZoom(1)}>원본 100%</button>
      <button className={zoom === 1.5 ? '' : 'secondary'} aria-pressed={zoom === 1.5} onClick={() => setZoom(1.5)}>확대 150%</button>
      <span>현재 {Math.round(zoom * 100)}% · 분석은 원본 이미지 사용</span>
    </div>
    <div className="image-viewport"><img src={src} alt={alt} onLoad={e => setWidth(e.currentTarget.naturalWidth)} style={{ width: width ? width * zoom : undefined }}/></div>
  </div>;
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selectedRoom, setRoom] = useState<string>(), [selectedShoe, setShoe] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [imageReview, setImageReview] = useState<ImageReview>(), [imageOutcomes, setImageOutcomes] = useState<Outcome[]>([]), [imageConfirmed, setImageConfirmed] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreview>();
  const [tieCounts, setTieCounts] = useState<Record<number, string>>({});
  const [imageRoom, setImageRoom] = useState('이미지 분석 방'), [imageShoe, setImageShoe] = useState(() => `이미지-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`), [imageStart, setImageStart] = useState(1), [imageSaved, setImageSaved] = useState('');
  const reviewPanel = useRef<HTMLDivElement>(null), request = useRef(0), imageReading = useRef(false);
  useEffect(() => { if (imageReview || imagePreview) reviewPanel.current?.scrollIntoView({ block: 'start' }); }, [imageReview, imagePreview]);
  const load = useCallback(async () => {
    const id = ++request.current;
    try { const data = await window.analyzer.snapshot(selectedRoom, selectedShoe); if (id === request.current) setSnapshot(data); }
    catch { setError('기록을 불러오지 못했습니다.'); }
  }, [selectedRoom, selectedShoe]);
  useEffect(() => { void load(); return window.analyzer.onChange(() => { void load(); }); }, [load]);
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await load(); } catch { setError('작업 실패 · 입력 형식이나 기존 회차 충돌을 확인하세요.'); } finally { setBusy(false); } }
  async function readImage() {
    if (imageReading.current) return;
    imageReading.current = true;
    setBusy(true); setError(''); setImageReview(undefined); setImagePreview(undefined); setImageConfirmed(false); setImageSaved('');
    try {
      await window.analyzer.closeBrowser();
      const review = await window.analyzer.pasteImage();
      if (review && 'recognitionError' in review) { setImagePreview(review); setImageOutcomes([]); setTieCounts({}); }
      else if (review) { setImageReview(review); setImageOutcomes(review.outcomes); setTieCounts(Object.fromEntries(review.tieAfter.map(index => [index, '1']))); setImageConfirmed(false); setImageSaved(''); }
    } catch (error) { setError(error instanceof Error ? error.message.split('Error:').at(-1)!.trim() : '그림판 이미지를 읽지 못했습니다.'); }
    finally { imageReading.current = false; setBusy(false); }
  }
  useEffect(() => {
    const paste = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!busy && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') && !target?.isContentEditable) {
        event.preventDefault(); if (!event.repeat) void readImage();
      }
    };
    // Image paste also works while a room name or shoe field has focus.
    // Ordinary text keeps the browser's normal paste behavior; never read it here.
    const pasteImage = (event: ClipboardEvent) => {
      if (!Array.from(event.clipboardData?.items ?? []).some(item => item.kind === 'file' && item.type.startsWith('image/'))) return;
      event.preventDefault();
      if (!busy) void readImage();
    };
    document.addEventListener('keydown', paste);
    document.addEventListener('paste', pasteImage, true);
    return () => { document.removeEventListener('keydown', paste); document.removeEventListener('paste', pasteImage, true); };
  }, [busy]);
  async function saveImage() {
    if (!imageReview || !imageConfirmed) return;
    setBusy(true); setError('');
    try {
      const tiesAfter = Object.entries(tieCounts).filter(([, count]) => Number(count) > 0).map(([index, count]) => ({ index: Number(index), count: Number(count) }));
      const result = await window.analyzer.saveImage({ reviewId: imageReview.id, roomName: imageRoom, shoeId: imageShoe, startRound: imageStart, outcomes: imageOutcomes, tiesAfter });
      setRoom(result.roomId); setShoe(result.shoeId); setImageReview(undefined);
      setImageSaved(`새 기록 ${result.added}개 저장 · 중복 기록은 추가하지 않습니다.${result.pending ? ` 충돌 ${result.pending}개는 확인 대기입니다.` : ''}`);
    } catch { setError('저장 실패 · 방 이름·슈·시작 번호를 확인하고, 만료된 이미지는 다시 읽어주세요.'); }
    finally { setBusy(false); }
  }
  const s = snapshot?.stats;
  const latest = snapshot?.results.at(-1)?.round;
  const unresolvedTies = imageReview?.tieAfter.some(index => !Number.isInteger(Number(tieCounts[index])) || Number(tieCounts[index]) < 1 || Number(tieCounts[index]) > 20);
  const validTies = new Map(Object.entries(tieCounts).filter(([, count]) => Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 20).map(([index, count]) => [Number(index), Number(count)]));
  const imageSequence = expandImageSequence(imageOutcomes, validTies);
  const imageTieTotal = imageSequence.filter(entry => entry.tieOffset > 0).length;
  const next = snapshot?.forecasts.filter(f => f.horizon === 1 && f.targetRound === (latest ?? 0) + 1) ?? [];
  return <div className="app">
    <header><div><span className="eyebrow">READ-ONLY ANALYTICS · 0.4.6</span><h1>Baccarat <span>Live Analyzer</span></h1></div><span className="safety">자동 베팅 없음</span></header>
    <div className="paste-guide" role="group" aria-label="그림판 캡처 붙여넣기 안내">
      <div><b>클립보드 이미지 바로 붙여넣기</b><p>이미지가 복사되어 있으면 이 프로그램에서 <kbd>Ctrl</kbd> + <kbd>V</kbd><br/>새 캡처가 필요할 때: <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> → 그림판 드래그</p></div>
      <button disabled={busy} onClick={() => void readImage()}>클립보드 이미지 붙여넣기 (Ctrl+V)</button>
    </div>
    {error && <div role="alert" className="error">{error}</div>}
    <main>
      <div className="left-pane">
        <section className="image-panel"><div className="panel-title"><h2>그림판 이미지 분석</h2><span>클립보드 입력 전용</span></div>
          <p className="note">캡처는 Windows 클립보드에 복사됩니다. 이 프로그램으로 돌아와 Ctrl+V를 누르면 인식 결과와 원본 미리보기가 나옵니다. 비드로드는 B/P/T를, 빅로드는 B/P 흐름을 읽고 초록 타이 표시의 횟수는 직접 확인합니다. 인식값은 확인 전까지 저장하지 않습니다.</p>
          <div className="image-fields"><label>방 이름<input aria-label="이미지 방 이름" value={imageRoom} maxLength={120} onChange={e => setImageRoom(e.target.value)}/></label><label>기록 그룹 / 슈<input aria-label="이미지 슈" value={imageShoe} maxLength={120} onChange={e => setImageShoe(e.target.value)}/></label><label>이미지 첫 결과의 기록 번호<input aria-label="이미지 시작 번호" type="number" min={1} max={999500} value={imageStart} onChange={e => setImageStart(Number(e.target.value))}/></label></div>
          <p className="note">같은 방·슈·시작 번호로 다시 넣으면 중복을 막습니다. 새 슈는 그룹 이름을 바꾸세요. 실제 회차를 모르면 별도 그룹에서 1부터 번호를 부여하세요. 이미지는 과거 기록으로 저장하며 사후 O/X 채점하지 않습니다.</p>
          {imageSaved && <p role="status" data-testid="image-save-status">{imageSaved}</p>}
          {imagePreview && <div className="image-review" ref={reviewPanel}>
            <p role="status" data-testid="image-preview-status"><b>이미지 불러오기 완료</b> · 그림판 자동 인식 실패</p>
            <ImageViewer key={imagePreview.preview} src={imagePreview.preview} alt="불러온 원본 이미지"/>
            <p>이미지는 들어왔습니다. 현재 이미지의 B/P/T 결과를 자동으로 읽지 못했습니다.</p>
            <p className="note">{imagePreview.recognitionError}</p>
            <RecognitionDetails value={imagePreview.diagnostics}/>
            <p className="note">결과를 읽기 전에는 통계에 저장하지 않습니다. 다른 그림판 이미지를 다시 붙여넣을 수 있습니다.</p>
          </div>}
          {imageReview && <div className="image-review" ref={reviewPanel}>
            {imageReview.preview && <ImageViewer key={imageReview.id} src={imageReview.preview} alt="붙여넣은 그림판 원본 이미지"/>}
            <p>{imageReview.preview ? imageReview.format === 'bead' ? '비드로드 인식' : '빅로드 인식 · 타이 횟수 확인 필요' : '직접 입력 기록 확인'}</p>
            <p><b data-testid="image-detected-count">{imageSequence.length}개 결과 인식 추정</b> · 원본과 각 결과의 순서를 확인하세요.</p>
            {imageReview.format === 'big-road' && <p className="tie-summary" data-testid="image-tie-summary">B/P 원 {imageOutcomes.length}개 + 타이 {imageTieTotal}회 = 총 {imageSequence.length}회{unresolvedTies ? ' · 타이 횟수 확인 대기' : ''}<br/>초록 표시당 타이 1회를 기본으로 넣었습니다. 원본에 표시된 횟수가 2회 이상이면 아래에서 수정하세요.</p>}
            <RecognitionDetails value={imageReview.diagnostics}/>
            <div className="image-outcomes">{imageSequence.map((entry, chronologicalIndex) => <label key={`${entry.sourceIndex}:${entry.tieOffset}`}>
              <span data-testid="image-round-number">{imageStart + chronologicalIndex}회차</span>
              {entry.tieOffset ? <span className="tie-result T" data-testid="image-tie-result" aria-label={`이미지 타이 결과 ${imageStart + chronologicalIndex}`}>T</span> : <>
                <select aria-label={`이미지 결과 ${entry.sourceIndex + 1}`} aria-description={`${imageStart + chronologicalIndex}회차`} className={entry.outcome} value={entry.outcome} onChange={e => { setImageOutcomes(previous => previous.map((value, i) => i === entry.sourceIndex ? e.target.value as Outcome : value)); setImageConfirmed(false); }}><option value="B">B</option><option value="P">P</option><option value="T">T</option></select>
                {imageReview.tieAfter.includes(entry.sourceIndex) && <span className="tie-field">뒤에 붙는 타이 횟수<input aria-label={`타이 횟수 ${entry.sourceIndex + 1}`} type="number" min={1} max={20} placeholder="확인 필요" value={tieCounts[entry.sourceIndex] ?? ''} onChange={e => { setTieCounts(previous => ({ ...previous, [entry.sourceIndex]: e.target.value })); setImageConfirmed(false); }}/></span>}
              </>}
            </label>)}</div>
            {imageReview.warnings.map(warning => <p className="note" key={warning}>{warning}</p>)}
            <label className="image-confirm"><input type="checkbox" checked={imageConfirmed} onChange={e => setImageConfirmed(e.target.checked)}/>원본의 B/P/T 순서·타이 횟수와 방·슈·시작 번호를 확인했습니다.</label>
            <button disabled={busy || !imageConfirmed || unresolvedTies || !imageRoom.trim() || !imageShoe.trim() || !Number.isInteger(imageStart) || imageStart < 1 || imageStart > 999500} onClick={() => void saveImage()}>확인한 그림판 기록 저장</button>
          </div>}
        </section>
        <section className="forecast-panel"><div className="panel-title"><h2>다음 회차 추정</h2><span>{latest ? `${latest + 1}회차 · 기록 범위 ${latest}회차까지` : '결과 기록 대기'}</span></div>
          {snapshot?.results.length && snapshot.results.every(result => result.source === 'demo') ? <p className="recognition-warning" data-testid="demo-data-warning">테스트 기록 분석 · 실제 Chrome 게임의 결과와 연결된 추정값이 아닙니다.</p> : null}
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
        <section><div className="panel-title"><h2>방별 통계</h2></div>
          <div className="selectors"><label>방<select aria-label="방" value={snapshot?.roomId ?? ''} onChange={e => { setRoom(e.target.value); setShoe(undefined); }}><option value="" disabled>방 기록 없음</option>{snapshot?.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>슈<select aria-label="슈" value={snapshot?.shoeId ?? ''} onChange={e => setShoe(e.target.value)}><option value="" disabled>슈 기록 없음</option>{snapshot?.rooms.find(r => r.id === snapshot.roomId)?.shoes.map(shoe => <option key={shoe}>{shoe}</option>)}</select></label></div>
          <div className="metrics"><div><span>전체 결과</span><b data-testid="total-results">{s?.total ?? 0}</b></div>{(['B', 'P', 'T'] as Outcome[]).map(o => <div key={o}><span className={o}>{labels[o]}</span><b>{s?.counts[o] ?? 0}</b><small>{percent(s?.ratios[o] ?? 0)}</small></div>)}</div>
          <div className="streaks"><span>현재 {s?.current.outcome ?? '—'} {s?.current.length ?? 0}연속</span><span>최장 B {s?.longest.B ?? 0} / P {s?.longest.P ?? 0}</span><span>전환 {s?.transitions ?? 0}회</span></div>
          <p className="note">통계는 선택한 방·슈에 확인 저장한 그림판 기록 기준입니다. 타이는 B/P 연속을 끊지 않습니다. 이미지 업데이트는 과거 기록으로 저장하며 사후 O/X 채점하지 않습니다.</p>
        </section>
        <section><div className="panel-title"><h2>방식별 성과</h2><span>동일 회차 {s?.comparisons ?? 0}개 비교</span></div>
          <div className="table-scroll"><table><thead><tr><th>방식</th><th>전체 O/X</th><th>타이 제외</th><th>최근 10/30/100</th><th>Brier ↓</th><th>로그 손실 ↓</th></tr></thead><tbody>{methods.map(m => {
            const a = s?.accuracy[m]; return <tr key={m}><th>{m}</th><td>{percent(a?.all.rate ?? null)}<small>{a?.all.correct ?? 0}/{a?.all.count ?? 0}</small></td><td>{percent(a?.all.noTieRate ?? null)}<small>{a?.all.noTieCorrect ?? 0}/{a?.all.noTieCount ?? 0}</small></td><td className="compact">{[a?.last10, a?.last30, a?.last100].map((v, i) => <span key={i}>{percent(v?.rate ?? null)} ({v?.count ?? 0})</span>)}</td><td>{a?.all.brier?.toFixed(3) ?? '—'}</td><td>{a?.all.logLoss?.toFixed(3) ?? '—'}</td></tr>;
          })}</tbody></table></div><p className="note">즉시 다음 회차 예측(horizon 1)만 공통 회차로 비교합니다. 실제 T도 O/X로 채점합니다. 타이 제외는 실제 결과 T인 회차만 제외합니다. 확률 오차는 낮을수록 좋습니다. 표본이 적으면 우수 방식을 단정하지 않습니다.</p>
        </section>
        {snapshot && snapshot.pending.length > 0 && <section className="pending"><h2>확인 대기 {snapshot.pending.length}개</h2>{snapshot.pending.map(p => <div key={p.id}><p>{p.roomName} / {p.shoeId} / {p.round}회차 <b className={p.outcome}>{p.outcome}</b> · {percent(p.confidence)}</p><small>{p.reason}</small><div><button disabled={busy} onClick={() => void action(() => window.analyzer.confirm(p.id, true))}>결과 확인</button><button className="secondary" disabled={busy} onClick={() => void action(() => window.analyzer.confirm(p.id, false))}>거절</button></div></div>)}</section>}
        <section><div className="panel-title"><h2>결과 그림장 · 비드로드</h2><span>위→아래 6행, 왼쪽→오른쪽</span></div><div className="bead-road" data-testid="bead-road">{snapshot?.results.map(r => <span key={r.id} className={`bead ${r.outcome}`} title={`${r.round}회차 ${r.outcome} · ${r.historical ? '기존 화면 기록' : '실시간 수집'}`}>{r.outcome}</span>)}</div></section>
        <section><h2>예측 O/X 이력</h2><div className="table-scroll history"><table><thead><tr><th>목표</th><th>방식</th><th>추정</th><th>실제</th><th>채점</th><th>사전 기록</th></tr></thead><tbody>{snapshot?.forecasts.slice(0, 160).map(f => <tr key={f.id}><td>{f.targetRound}</td><td>{f.method}</td><td className={f.pick}>{f.pick}</td><td>{f.actual ?? '대기'}</td><td>{f.mark ?? '—'}</td><td><small>{f.cutoffRound}회차 기준 · {f.horizon}회차 앞<br/>{date(f.createdAt)}</small></td></tr>)}</tbody></table></div><p className="note">최근 예측 160개 표시 · 기존 결과의 사후 채점은 하지 않습니다.</p></section>
        <section><h2>결과 기록</h2><div className="table-scroll history"><table><thead><tr><th>회차</th><th>결과</th><th>시각</th><th>수집</th></tr></thead><tbody>{snapshot?.results.slice(-100).reverse().map(r => <tr key={r.id}><td>{r.round}</td><td className={r.outcome}>{r.outcome}</td><td>{date(r.occurredAt ?? r.recordedAt)}{!r.occurredAt && <small>화면에서 관측한 시각</small>}</td><td>{r.source} · {r.historical ? '기존' : '신규'}</td></tr>)}</tbody></table></div></section>
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
