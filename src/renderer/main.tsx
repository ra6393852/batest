import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { methods, type AnalyzerAPI, type Snapshot, type Outcome, type ImageReview, type ImagePreview, type RecognitionDiagnostics, type CaptureWindow, type CaptureInfo } from '../shared/types';
import { accuracy } from '../analysis/engine';
import { expandImageSequence } from '../shared/image-sequence';
import {reviewHistory} from '../analysis/history-review';
import type {AccessStatus} from '../shared/types';
import './styles.css';
import {LicenseGate} from './license-gate';
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
function CapturePreview({capture}:{capture:CaptureInfo}){
  const [zoom,setZoom]=useState<'fit'|1|2>('fit'),pan=useRef<{x:number;y:number;left:number;top:number}|undefined>(undefined);
  return <div className="capture-viewer"><div className="image-zoom" role="group" aria-label="자동 이미지 확대">
    <button className={zoom==='fit'?'':'secondary'} aria-pressed={zoom==='fit'} onClick={()=>setZoom('fit')}>한눈에 보기</button>
    <button className={zoom===1?'':'secondary'} aria-pressed={zoom===1} onClick={()=>setZoom(1)}>원본 100%</button>
    <button className={zoom===2?'':'secondary'} aria-pressed={zoom===2} onClick={()=>setZoom(2)}>2배 200%</button>
    <span>승패 판독{capture.analysisMs!==undefined?` ${capture.analysisMs<1?'<1':capture.analysisMs}ms`:''}{capture.recognitionMs!==undefined?` · 캡처 포함 ${capture.recognitionMs}ms`:''}</span>
  </div><div className={`capture-viewport${zoom==='fit'?' fit-preview':''}`} tabIndex={0} aria-label="자동 이미지 드래그 보기" data-testid="capture-viewport"
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();const v=e.currentTarget;v.setPointerCapture(e.pointerId);pan.current={x:e.clientX,y:e.clientY,left:v.scrollLeft,top:v.scrollTop};}}
    onPointerMove={e=>{if(!pan.current)return;const v=e.currentTarget;v.scrollLeft=pan.current.left+pan.current.x-e.clientX;v.scrollTop=pan.current.top+pan.current.y-e.clientY;}}
    onPointerUp={e=>{pan.current=undefined;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onPointerCancel={()=>{pan.current=undefined;}}>
    <img data-testid="capture-preview" draggable={false} src={zoom===1?(capture.originalPreview??capture.preview):capture.preview} alt="자동으로 가져온 그림판"/>
  </div></div>;
}
function AccessGate(){
  const [access,setAccess]=useState<AccessStatus>(),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void window.analyzer.accessStatus().then(setAccess).catch(()=>setError('프로그램 잠금 상태를 확인하지 못했습니다.'));},[]);
  useEffect(()=>{if(!access?.retryAfterMs)return;const timer=setTimeout(()=>setAccess(value=>value?{...value,retryAfterMs:0}:value),access.retryAfterMs);return()=>clearTimeout(timer);},[access?.retryAfterMs]);
  if(access&&!access.locked)return <App/>;
  return <div className="access-screen"><form className="access-card" onSubmit={e=>{e.preventDefault();if(busy||!access||access.retryAfterMs)return;setBusy(true);setError('');
    void window.analyzer.unlock(password).then(result=>{setAccess(result);if(result.locked)setError(result.retryAfterMs?'잠시 후 다시 시도하세요.':'암호가 일치하지 않습니다.');else setPassword('');})
      .catch(()=>setError('잠금을 해제하지 못했습니다.')).finally(()=>setBusy(false));}}>
    <span className="eyebrow">판매 서버 미설정 · 관리자 검토용</span><h1>Baccarat <span>Live Analyzer</span></h1><p>프로그램을 사용하려면 관리자 암호를 입력하세요. 이 검토용 파일에는 판매용 코드 보호가 적용되지 않았습니다.</p>
    <label>관리자 암호<input autoFocus type="password" autoComplete="off" aria-label="관리자 암호" value={password} maxLength={128} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}<button disabled={busy||!access||!!access.retryAfterMs||!password}>{busy?'확인 중…':'잠금 해제'}</button>
  </form></div>;
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selectedRoom, setRoom] = useState<string>(), [selectedShoe, setShoe] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [capture,setCapture]=useState<CaptureInfo>(),[captureWindows,setCaptureWindows]=useState<CaptureWindow[]>([]),[captureId,setCaptureId]=useState('');
  const [imageReview, setImageReview] = useState<ImageReview>(), [imageOutcomes, setImageOutcomes] = useState<Outcome[]>([]), [imageConfirmed, setImageConfirmed] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreview>();
  const [tieCounts, setTieCounts] = useState<Record<number, string>>({});
  const [imageScores, setImageScores] = useState<string[]>([]);
  const [forecastSelection, setForecastSelection] = useState<{ key: string; cutoff: number | 'latest' }>();
  const [showAllGrades,setShowAllGrades]=useState(true);
  const [imageRoom, setImageRoom] = useState('이미지 분석 방'), [imageShoe, setImageShoe] = useState(() => `이미지-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`), [imageStart, setImageStart] = useState(1), [imageSaved, setImageSaved] = useState('');
  const reviewPanel = useRef<HTMLDivElement>(null), request = useRef(0), imageReading = useRef(false);
  const draggingWindow=useRef(false);
  useEffect(() => { if (imageReview || imagePreview) reviewPanel.current?.scrollIntoView({ block: 'start' }); }, [imageReview, imagePreview]);
  const load = useCallback(async () => {
    const id = ++request.current;
    try { const data = await window.analyzer.snapshot(selectedRoom, selectedShoe); if (id === request.current) setSnapshot(data); }
    catch { setError('기록을 불러오지 못했습니다.'); }
  }, [selectedRoom, selectedShoe]);
  useEffect(() => { void load(); return window.analyzer.onChange(() => { void load(); }); }, [load]);
  useEffect(()=>{
    const receive=(info:CaptureInfo)=>{setCapture(previous=>info.previewUnchanged?{...info,preview:previous?.preview,originalPreview:previous?.originalPreview}:info);if(info.enabled&&info.state==='collecting'&&info.roomId&&info.shoeId){setRoom(info.roomId);setShoe(info.shoeId);}};
    void window.analyzer.captureInfo().then(receive);return window.analyzer.onCapture(receive);
  },[]);
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await load(); } catch(error) { setError(error instanceof Error?error.message.split('Error:').at(-1)!.trim():'작업 실패 · 입력 형식이나 기존 회차 충돌을 확인하세요.'); } finally { setBusy(false); } }
  async function readImage() {
    if (imageReading.current) return;
    imageReading.current = true;
    setBusy(true); setError(''); setImageReview(undefined); setImagePreview(undefined); setImageConfirmed(false); setImageSaved('');
    try {
      if(capture?.enabled)await window.analyzer.captureStop();
      await window.analyzer.closeBrowser();
      const review = await window.analyzer.pasteImage();
      if (review && 'recognitionError' in review) { setImagePreview(review); setImageOutcomes([]); setTieCounts({}); setImageScores([]); }
      else if (review) { setImageReview(review); setImageOutcomes(review.outcomes); setImageScores(review.outcomes.map((_, i) => review.scores?.[i] == null ? '' : String(review.scores[i]))); setTieCounts(Object.fromEntries(review.tieAfter.map(index => [index, '1']))); setImageConfirmed(false); setImageSaved(''); }
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
      const result = await window.analyzer.saveImage({ reviewId: imageReview.id, roomName: imageRoom, shoeId: imageShoe, startRound: imageStart, outcomes: imageOutcomes, tiesAfter,
        ...(imageReview.format === 'bead' ? { scores: imageScores.map(value => value === '' ? null : Number(value)) } : {}) });
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
  const invalidScores = imageScores.some(value => value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 9));
  const forecastKey = `${snapshot?.roomId}:${snapshot?.shoeId}`;
  const cutoffs = [...new Set(snapshot?.forecasts.map(f => f.cutoffRound) ?? [])].sort((a, b) => b - a);
  const selectedCutoff = forecastSelection?.key === forecastKey ? forecastSelection.cutoff : 'latest';
  const cutoff = selectedCutoff !== 'latest' && cutoffs.includes(selectedCutoff) ? selectedCutoff : cutoffs[0];
  const bundle = snapshot?.forecasts.filter(f => f.cutoffRound === cutoff) ?? [];
  const history=useMemo(()=>reviewHistory(snapshot?.results??[]),[snapshot?.results]);
  const historyByRound=useMemo(()=>new Map(history.rows.map(row=>[row.round,row])),[history]);
  const pastForecasts=useMemo(()=>{
    const index=new Map<string,Snapshot['forecasts'][number]>();
    for(const f of snapshot?.forecasts??[])if(f.mark){const key=`${f.targetRound}:${f.method}`,old=index.get(key);if(!old||f.cutoffRound>old.cutoffRound)index.set(key,f);}
    return index;
  },[snapshot?.forecasts]);
  const scoredRounds=useMemo(()=>[...new Set([...pastForecasts.values()].map(f=>f.targetRound))].sort((a,b)=>a-b),[pastForecasts]);
  const recentScoredRounds=useMemo(()=>showAllGrades?history.rows.map(row=>row.round):scoredRounds.slice(-7),[showAllGrades,history.rows,scoredRounds]);
  const latestScoredRound=scoredRounds.at(-1);
  const renderedPastRows=useMemo(()=>recentScoredRounds.map(round=>{
            const row=historyByRound.get(round)!;
            const live=pastForecasts.has(`${round}:A`);
            return <tr key={`past:${round}`} className={live?(round===latestScoredRound?'latest-scored':'scored-round'):'retrospective-row'} data-testid={`history-round-${round}`} data-round={round}>
              <th>{round}<small>실제 {row.actual}</small>{!live&&<small className="record-kind">과거 검증</small>}</th>{methods.flatMap(method=>{
                const f=pastForecasts.get(`${round}:${method}`),model=row.models.find(m=>m.method===method)!;
                const pick=f?.pick??model.pick,mark=f?.mark??model.mark;
                return [<td key={`${method}:past-pick`} className={pick} title={f?`${f.cutoffRound}회차 기준 · ${f.horizon}회차 앞 · ${f.basis}`:`과거 검증 · 앞선 ${row.priorCount}개 결과만 사용 · ${model.basis}`}><strong>{pick}</strong></td>,
                  <td key={`${method}:past-mark`} className={mark==='O'?'T':'B'} data-testid={round===latestScoredRound&&f?`latest-mark-${method}`:undefined} data-kind={f?'live':'backtest'}><b>{mark}</b></td>];
              })}</tr>;
          }),[recentScoredRounds,historyByRound,pastForecasts,latestScoredRound]);
  const bestRate = Math.max(...methods.map(m => s?.advanceAccuracy[m].rate ?? -1));
  const bestMethods = methods.filter(m => s?.advanceAccuracy[m].rate === bestRate);
  const captureWaiting=capture?.enabled&&(capture.state!=='collecting'||capture.roomId!==snapshot?.roomId||capture.shoeId!==snapshot?.shoeId||capture.rounds!==latest);
  return <div className={`app${capture?.enabled?' is-live':''}`}>
    <header className="window-drag-handle" aria-label="프로그램 창 이동" title="이 제목 부분을 드래그하면 프로그램 창이 이동합니다."
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);draggingWindow.current=true;window.analyzer.beginWindowDrag({x:e.screenX,y:e.screenY});}}
      onPointerMove={e=>{if(draggingWindow.current)window.analyzer.moveWindowDrag({x:e.screenX,y:e.screenY});}}
      onPointerUp={e=>{draggingWindow.current=false;window.analyzer.endWindowDrag();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={()=>{draggingWindow.current=false;window.analyzer.endWindowDrag();}}>
      <div><span className="eyebrow">READ-ONLY ANALYTICS · {capture?.appVersion??'버전 확인 중'}</span><h1>Baccarat <span>Live Analyzer</span></h1></div><span className="safety">자동 베팅 없음</span></header>

    {!capture?.enabled&&<div className="paste-guide" role="group" aria-label="그림판 캡처 붙여넣기 안내">
      <div><b>클립보드 이미지 바로 붙여넣기</b><p>이미지가 복사되어 있으면 이 프로그램에서 <kbd>Ctrl</kbd> + <kbd>V</kbd><br/>새 캡처가 필요할 때: <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> → 그림판 드래그</p></div>
      <button disabled={busy} onClick={() => void readImage()}>클립보드 이미지 붙여넣기 (Ctrl+V)</button>
    </div>}
    {error && <div role="alert" className="error">{error}</div>}
    <main>
      <div className="left-pane">
    <section className="capture-panel"><div className="panel-title"><h2>게임 창 이미지 자동 가져오기</h2><span data-testid="capture-version">실행 버전 {capture?.appVersion??'확인 중'} · 1초 간격</span></div>
      <div className="capture-controls"><button disabled={busy} onClick={()=>void action(async()=>{const sources=await window.analyzer.captureWindows();if(!sources.length)throw new Error('선택할 창이 없습니다. Chrome 게임 창을 먼저 열어 주세요.');setCaptureWindows(sources);setCaptureId(sources.find(s=>/Chrome/i.test(s.name))?.id??sources[0]?.id??'');})}>게임 창 선택</button>
        {captureWindows.length>0&&<><select aria-label="자동 가져올 게임 창" value={captureId} onChange={e=>setCaptureId(e.target.value)}>{captureWindows.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><button disabled={busy||!captureId} onClick={()=>void action(()=>window.analyzer.captureStart(captureId))}>자동 가져오기 시작</button></>}
        {capture?.enabled&&<><button className="secondary" onClick={()=>void action(()=>window.analyzer.captureStop())}>자동 가져오기 중지</button><button className="secondary" onClick={()=>void action(()=>window.analyzer.captureNewShoe())}>새 그림판 기록</button></>}
      </div>
      <p role="status" data-testid="capture-status">{capture?.message??'게임 창 선택 대기'}</p>
      {capture?.enabled&&capture.detectedResults!==undefined&&<p data-testid="capture-count" className="note">현재 화면 {capture.detectedResults}개 원 후보 · {captureWaiting?'확정 대기':`${capture.rounds??0}개 저장 확인`}</p>}
      {capture?.preview&&<div className="capture-preview" data-testid="live-monitor"><div className="monitor-title">실시간 그림판 모니터<small>캡처 {capture.capturedAt?new Date(capture.capturedAt).toLocaleTimeString('ko-KR'):''}{capture.processedAt?` · 판독 ${new Date(capture.processedAt).toLocaleTimeString('ko-KR')}`:''}</small></div><CapturePreview capture={capture}/></div>}
      <details className="capture-help"><summary>자동 수집 사용 안내</summary>
        <p>Chrome에서 바카라에 들어간 뒤 <b>게임 창 선택 → 자동 가져오기 시작</b>을 누르세요. 그림판이 보이게 열어 두면 됩니다. 방 이름은 읽지 않습니다.</p>
        <p>이미지는 PC에서만 처리합니다. 두 번 확인한 뒤 저장하며, 표시 번호는 보이는 결과의 순서입니다. 다른 그림판은 별도 기록으로 시작합니다. 같은 내용의 다른 게임은 새 그림판 기록을 누르세요.</p>
        <p>한눈에 보기는 표시 크기만 맞춥니다. 판독은 항상 2배 이미지로 처리하며 숫자는 점수로 별도 기록합니다. 200% 확대 이미지는 드래그로 이동할 수 있습니다.</p>
      </details>
    </section>
        {!capture?.enabled&&<section className="image-panel"><div className="panel-title"><h2>그림판 이미지 분석</h2><span>클립보드 입력</span></div>
          <p className="note">캡처는 Windows 클립보드에 복사됩니다. 이 프로그램으로 돌아와 Ctrl+V를 누르면 인식 결과와 원본 미리보기가 나옵니다. 비드로드는 B/P/T를, 빅로드는 B/P 흐름을 읽고 초록 타이 표시의 횟수는 직접 확인합니다. 인식값은 확인 전까지 저장하지 않습니다.</p>
          <div className="image-fields"><label>방 이름<input aria-label="이미지 방 이름" value={imageRoom} maxLength={120} onChange={e => setImageRoom(e.target.value)}/></label><label>기록 그룹 / 슈<input aria-label="이미지 슈" value={imageShoe} maxLength={120} onChange={e => setImageShoe(e.target.value)}/></label><label>이미지 첫 결과의 기록 번호<input aria-label="이미지 시작 번호" type="number" min={1} max={999500} value={imageStart} onChange={e => setImageStart(Number(e.target.value))}/></label></div>
          <p className="note">같은 방·슈·시작 번호로 이어서 붙여넣으면 중복을 막습니다. 처음 사진은 기준 기록으로 저장합니다. 이후 새 결과는 붙여넣기 전에 저장된 예측에만 O/X를 표시합니다. 새 슈는 그룹 이름을 바꾸세요.</p>
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
                {imageReview.format === 'bead' && <span className="score-field">표시 점수<input aria-label={`이미지 점수 ${entry.sourceIndex + 1}`} type="number" min={0} max={9} placeholder="미확인" value={imageScores[entry.sourceIndex] ?? ''} onChange={e => { setImageScores(previous => previous.map((value, i) => i === entry.sourceIndex ? e.target.value : value)); setImageConfirmed(false); }}/></span>}
                {imageReview.tieAfter.includes(entry.sourceIndex) && <span className="tie-field">뒤에 붙는 타이 횟수<input aria-label={`타이 횟수 ${entry.sourceIndex + 1}`} type="number" min={1} max={20} placeholder="확인 필요" value={tieCounts[entry.sourceIndex] ?? ''} onChange={e => { setTieCounts(previous => ({ ...previous, [entry.sourceIndex]: e.target.value })); setImageConfirmed(false); }}/></span>}
              </>}
            </label>)}</div>
            {imageReview.warnings.map(warning => <p className="note" key={warning}>{warning}</p>)}
            <label className="image-confirm"><input type="checkbox" checked={imageConfirmed} onChange={e => setImageConfirmed(e.target.checked)}/>원본의 승패·입력 점수·타이 횟수와 방·슈·시작 번호를 확인했습니다.</label>
            <button disabled={busy || !imageConfirmed || unresolvedTies || invalidScores || imageSequence.length > 500 || !imageRoom.trim() || !imageShoe.trim() || !Number.isInteger(imageStart) || imageStart < 1 || imageStart > 999500} onClick={() => void saveImage()}>확인한 그림판 기록 저장</button>
          </div>}
        </section>}

      </div>
      <div className="right-pane">
        <section className="forecast-panel"><div className="panel-title"><h2>다음 4회차 예측 · O/X</h2><span data-testid="forecast-basis-title">{captureWaiting?'현재 그림판 확인 중 · 예측 기준 갱신 대기':cutoff !== undefined ? `${cutoff}회차 기준 · ${cutoff + 1}~${cutoff + 4}회차` : '결과 기록 대기'}</span></div>
          {!captureWaiting&&<label className="forecast-cutoff">예측 기준 회차<select aria-label="예측 기준 회차" value={selectedCutoff} onChange={e => setForecastSelection({ key: forecastKey, cutoff: e.target.value === 'latest' ? 'latest' : Number(e.target.value) })}><option value="latest">최신 완료 회차 기준 (자동 갱신)</option>{cutoffs.map(value => <option key={value} value={value}>{value}회차 기준 → {value + 1}~{value + 4}회차{value === latest ? ' (최신)' : ''}</option>)}</select></label>}
          {captureWaiting&&<div className="forecast-cutoff">예측 기준 회차<span className="cutoff-placeholder">현재 그림판 확인 중</span></div>}
          {selectedCutoff==='latest'&&<div className="history-view-controls" role="group" aria-label="회차 보기">
            <button disabled={!!captureWaiting} className={showAllGrades?'':'secondary'} aria-pressed={showAllGrades} onClick={()=>setShowAllGrades(true)}>1회차부터 보기</button>
            <button disabled={!!captureWaiting} className={!showAllGrades?'':'secondary'} aria-pressed={!showAllGrades} onClick={()=>setShowAllGrades(false)}>실시간 보기</button>
          </div>}
          {showAllGrades&&history.rows.length>0&&<div className="history-summary" data-testid="history-summary"><b>과거 검증 · {history.rows.length}회</b><span>각 판보다 앞선 기록만 사용한 재계산입니다. 실제 사전 예측 적중률과 별도로 셉니다.</span>
            <div>{methods.map(m=><span key={m} data-testid={`history-accuracy-${m}`}>{m} <b>{percent(history.accuracy[m].rate)}</b> · O {history.accuracy[m].correct} / X {history.accuracy[m].count-history.accuracy[m].correct}</span>)}</div>
          </div>}
          {snapshot?.results.length && snapshot.results.every(result => result.source === 'demo') ? <p className="recognition-warning" data-testid="demo-data-warning">테스트 기록 분석 · 실제 Chrome 게임의 결과와 연결된 추정값이 아닙니다.</p> : null}
          <p className="note forecast-legend" data-testid="forecast-read-state" style={{color:captureWaiting?'#ffdb8a':undefined}}>{captureWaiting?'판독 대기 · 아래는 저장된 이전 확정 기록입니다.':'사전 예측 적중률 = O / (O + X) · A: 8덱 이론값 · B/C/D: 과거 패턴 추정'}</p><div className="table-scroll"><table className="forecast-matrix"><thead>
            <tr><th rowSpan={3}>회차 / 실제</th>{methods.map(method=><th key={method} colSpan={2} data-testid={`forecast-method-${method}`}><b>{method}</b><small>{methodNames[method]}</small></th>)}</tr>
            <tr>{methods.map(method=>{const a=s?.advanceAccuracy[method],f=bundle.find(f=>f.method===method&&f.horizon===1);return <th key={method} colSpan={2} data-testid={`method-accuracy-${method}`}><b className="hit-rate">{a?.count?percent(a.rate):'채점 대기'}</b><small>O {a?.correct??0} / X {(a?.count??0)-(a?.correct??0)}<br/>{method==='A'?'8덱 이론값 · 항상 B':`분석 표본 ${f?.sampleSize??0}개${f?.sampleSize===0?' · 이론값 사용':''}`}</small></th>;})}</tr>
            <tr>{methods.flatMap(method=>[<th key={`${method}:pick`}>예상 답</th>,<th key={`${method}:mark`}>O/X</th>])}</tr>
          </thead><tbody>{selectedCutoff==='latest'&&renderedPastRows}{captureWaiting?[1,2,3,4].map(horizon=><tr key={`waiting:${horizon}`} className="waiting-forecast"><th>—<small>판독 대기</small></th>{horizon===1&&<td colSpan={8} rowSpan={4}>현재 그림판 확인 후 다음 4회차 예측을 표시합니다.</td>}</tr>):[1,2,3,4].map(horizon=>{
            const known=cutoff===undefined?undefined:snapshot?.results.find(r=>r.round===cutoff+horizon);
            const actual=bundle.find(f=>f.horizon===horizon&&f.actual)?.actual??known?.outcome;
            return <tr key={horizon} data-testid={`forecast-row-${horizon}`} data-round={cutoff===undefined?undefined:cutoff+horizon}><th>{cutoff===undefined?'—':cutoff+horizon}<small>{actual?`실제 ${actual}`:'대기'}</small></th>{methods.flatMap(method=>{
              const f=bundle.find(value=>value.horizon===horizon&&value.method===method);
              return [<td key={`${method}:pick`} className={f?.pick} data-testid={`forecast-${method}-${horizon}`} title={f?`${labels[f.pick]} · ${f.basis} · 표본 ${f.sampleSize}개`:'예측 생성 대기'}><strong>{f?.pick??'—'}</strong></td>,<td key={`${method}:mark`} data-testid={`mark-${method}-${horizon}`} title={known&&!f?.mark?'초기/복원 기록 또는 예측보다 먼저 관측한 결과여서 채점에서 제외합니다.':undefined} className={f?.mark==='O'?'T':f?.mark==='X'?'B':''}>{f?.mark??(known?'제외':'대기')}</td>];
            })}</tr>;
          })}</tbody><tfoot style={{visibility:captureWaiting?'hidden':undefined}} aria-hidden={captureWaiting||undefined}><tr><th>선택 묶음</th>{methods.map(method=>{const fs=bundle.filter(f=>f.method===method),a=accuracy(fs);return <td key={method} colSpan={2} data-testid={`bundle-accuracy-${method}`}>{percent(a.rate)}<small>O {a.correct} / X {a.count-a.correct}<br/>대기 {fs.length-a.count}</small></td>;})}</tr></tfoot></table></div>
          {snapshot?.results.length&&s?.advanceComparisons===0?<p style={{visibility:captureWaiting?'hidden':undefined}} aria-hidden={captureWaiting||undefined} className="grading-note" data-testid="grading-wait">채점된 예측 0건 · 처음 읽은 기록은 기준 자료입니다. {latest===undefined?'':`${latest+1}회차부터`} 새 결과가 확인되면 O/X와 적중률을 표시합니다. 다른 방 이동·수집 중단 뒤 복원한 기록은 사후 채점하지 않습니다.</p>:null}

          <details className="forecast-probabilities" style={{visibility:captureWaiting?'hidden':undefined}} aria-hidden={captureWaiting||undefined}><summary>추정 확률·표본 보기</summary><table><thead><tr><th>회차</th><th>방식</th><th>B%</th><th>P%</th><th>T%</th><th>표본</th></tr></thead><tbody>{bundle.map(f=><tr key={f.id} title={f.basis}><td>{f.targetRound}</td><td>{f.method}</td>{(['B','P','T'] as Outcome[]).map(o=><td key={o}>{(f.probabilities[o]*100).toFixed(2)}</td>)}<td>{f.sampleSize}</td></tr>)}</tbody></table></details>
          <details className="forecast-help"><summary>예측·채점 기준</summary><p className="note">A는 8덱 이론값, B/C/D는 과거 결과의 평활 추정입니다. 카드 구성과 실제 다음 판의 확률은 알 수 없습니다. 표본이 많아도 예측력이 보장되지는 않습니다.</p><p className="note">선택한 기준 회차의 예측값은 고정됩니다. 적중률은 실제 결과가 확인된 예측만 셉니다. 예측 저장 → 새 이미지 관측 순서로 채점합니다. 실제 게임 발생 시각은 자동 확인하지 못하며, 수집 중단·방 이동 중 놓친 기록은 사후 채점하지 않습니다.</p><p className="note">과거 행은 해당 회차에 대한 가장 최근 기준의 채점된 예측을 표시합니다. 누적 적중률은 보존된 4회차 사전 예측 전체 기준입니다. 원래 저장한 예측값은 수정하지 않습니다.</p></details>
        </section>
        <section><div className="panel-title"><h2>방별 통계</h2>{captureWaiting&&<span>현재 화면 판독 대기 · 아래는 저장된 기록</span>}</div>
          <div className="selectors"><label>방<select aria-label="방" value={snapshot?.roomId ?? ''} onChange={e => { setRoom(e.target.value); setShoe(undefined); }}><option value="" disabled>방 기록 없음</option>{snapshot?.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>슈<select aria-label="슈" value={snapshot?.shoeId ?? ''} onChange={e => setShoe(e.target.value)}><option value="" disabled>슈 기록 없음</option>{snapshot?.rooms.find(r => r.id === snapshot.roomId)?.shoes.map(shoe => <option key={shoe}>{shoe}</option>)}</select></label></div>
          <div className="metrics"><div><span>전체 결과</span><b data-testid="total-results">{s?.total ?? 0}</b></div>{(['B', 'P', 'T'] as Outcome[]).map(o => <div key={o}><span className={o}>{labels[o]}</span><b>{s?.counts[o] ?? 0}</b><small>{percent(s?.ratios[o] ?? 0)}</small></div>)}</div>
          <div className="streaks"><span>현재 {s?.current.outcome ?? '—'} {s?.current.length ?? 0}연속</span><span>최장 B {s?.longest.B ?? 0} / P {s?.longest.P ?? 0}</span><span>전환 {s?.transitions ?? 0}회</span></div>
          <p className="note">통계는 선택한 방·슈 기준입니다. 타이는 B/P 연속을 끊지 않습니다. 처음 사진은 기준 기록이며 이후 새로 관측한 결과만 사전 예측에 채점합니다.</p>
          {snapshot && <details className="score-distribution"><summary>표시 점수 분포 · 확인 {snapshot.results.filter(r => r.score !== undefined).length}회</summary><table><thead><tr><th>점수</th><th>B</th><th>P</th><th>T</th></tr></thead><tbody>{Array.from({length:10}, (_, score) => <tr key={score}><td>{score}</td>{(['B','P','T'] as Outcome[]).map(o => <td key={o}>{snapshot.results.filter(r => r.score === score && r.outcome === o).length}</td>)}</tr>)}</tbody></table></details>}
        </section>
        <section><div className="panel-title"><h2>방식별 성과</h2><span>동일 회차 {s?.comparisons ?? 0}개 비교</span></div>
          <p className="note">4회차 사전 예측 누적 · 공통 {s?.advanceComparisons ?? 0}건 (같은 결과에 대한 서로 다른 기준 회차의 예측을 포함)</p>
          {bestRate >= 0 && <p className="tie-summary">현재 기록에서 적중률이 가장 높은 방식: {bestMethods.join(' / ')} · {percent(bestRate)}</p>}
          <table className="advance-accuracy"><thead><tr><th>방식</th><th>전체 적중률</th><th>O / X</th><th>타이 제외</th></tr></thead><tbody>{methods.map(m => { const a = s?.advanceAccuracy[m]; return <tr key={m}><th>{m}</th><td>{percent(a?.rate ?? null)}</td><td>{a?.correct ?? 0} / {(a?.count ?? 0) - (a?.correct ?? 0)}</td><td>{percent(a?.noTieRate ?? null)}</td></tr>; })}</tbody></table>
          <p className="note">아래는 즉시 다음 회차 예측만 비교합니다.</p>
          <div className="table-scroll"><table><thead><tr><th>방식</th><th>전체 O/X</th><th>타이 제외</th><th>최근 10/30/100</th><th>Brier ↓</th><th>로그 손실 ↓</th></tr></thead><tbody>{methods.map(m => {
            const a = s?.accuracy[m]; return <tr key={m}><th>{m}</th><td>{percent(a?.all.rate ?? null)}<small>{a?.all.correct ?? 0}/{a?.all.count ?? 0}</small></td><td>{percent(a?.all.noTieRate ?? null)}<small>{a?.all.noTieCorrect ?? 0}/{a?.all.noTieCount ?? 0}</small></td><td className="compact">{[a?.last10, a?.last30, a?.last100].map((v, i) => <span key={i}>{percent(v?.rate ?? null)} ({v?.count ?? 0})</span>)}</td><td>{a?.all.brier?.toFixed(3) ?? '—'}</td><td>{a?.all.logLoss?.toFixed(3) ?? '—'}</td></tr>;
          })}</tbody></table></div><p className="note">즉시 다음 회차 예측(horizon 1)만 공통 회차로 비교합니다. 실제 T도 O/X로 채점합니다. 타이 제외는 실제 결과 T인 회차만 제외합니다. 확률 오차는 낮을수록 좋습니다. 표본이 적으면 우수 방식을 단정하지 않습니다.</p>
        </section>
        {snapshot && snapshot.pending.length > 0 && <section className="pending"><h2>확인 대기 {snapshot.pending.length}개</h2>{snapshot.pending.map(p => <div key={p.id}><p>{p.roomName} / {p.shoeId} / {p.round}회차 <b className={p.outcome}>{p.outcome}</b> · {percent(p.confidence)}</p><small>{p.reason}</small><div><button disabled={busy} onClick={() => void action(() => window.analyzer.confirm(p.id, true))}>결과 확인</button><button className="secondary" disabled={busy} onClick={() => void action(() => window.analyzer.confirm(p.id, false))}>거절</button></div></div>)}</section>}
        <section><div className="panel-title"><h2>결과 그림장 · 비드로드</h2><span>위→아래 6행, 왼쪽→오른쪽</span></div><div className="bead-road" data-testid="bead-road">{snapshot?.results.map(r => <span key={r.id} className={`bead ${r.outcome}`} title={`${r.round}회차 ${r.outcome} · ${r.historical ? '기존 화면 기록' : '실시간 수집'}`}>{r.outcome}</span>)}</div></section>
        <section><h2>예측 O/X 이력</h2><div className="table-scroll history"><table><thead><tr><th>목표</th><th>방식</th><th>추정</th><th>실제</th><th>채점</th><th>사전 기록</th></tr></thead><tbody>{snapshot?.forecasts.slice(0, 160).map(f => <tr key={f.id}><td>{f.targetRound}</td><td>{f.method}</td><td className={f.pick}>{f.pick}</td><td>{f.actual ?? '대기'}</td><td>{f.mark ?? '—'}</td><td><small>{f.cutoffRound}회차 기준 · {f.horizon}회차 앞<br/>{date(f.createdAt)}</small></td></tr>)}</tbody></table></div><p className="note">최근 예측 160개 표시 · 기존 결과의 사후 채점은 하지 않습니다.</p></section>
        <section><h2>결과 기록</h2><div className="table-scroll history"><table><thead><tr><th>회차</th><th>결과</th><th>표시 점수</th><th>시각</th><th>수집</th></tr></thead><tbody>{snapshot?.results.slice(-100).reverse().map(r => <tr key={r.id}><td>{r.round}</td><td className={r.outcome}>{r.outcome}</td><td>{r.score ?? '—'}</td><td>{date(r.occurredAt ?? r.recordedAt)}{!r.occurredAt && <small>기록 확인 시각</small>}</td><td>{r.source} · {r.historical ? '기준 기록' : '추가 관측'}</td></tr>)}</tbody></table></div></section>
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<LicenseGate review={<AccessGate/>}><App/></LicenseGate>);
