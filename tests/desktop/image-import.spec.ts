import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleOutcomes, smallRoadBitmap } from '../fixtures/road-bitmap';
import { circleRoadBitmap, circleSequence, shortTieRoadBitmap, shortTieSequence } from '../fixtures/circle-road-bitmap';

test('image Ctrl+V works on dashboard and focused inputs while text paste stays unchanged', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-paste-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])] });
    const page = await app.firstWindow();
    await expect(page.getByRole('group', { name: '그림판 캡처 붙여넣기 안내' })).toContainText('Win');
    await expect(page.getByRole('button',{name:'게임 창 선택',exact:true})).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chrome 확장 설치 폴더', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '시뮬레이션 실행', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '허용된 프로필 가져오기', exact: true })).toHaveCount(0);
    const copyRoad = async (format: 'bead' | 'big-road') => {
      const road = smallRoadBitmap(format);
      await app!.evaluate(async ({ nativeImage, clipboard, ClipboardItem }, input) => {
        const png = nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG();
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
      }, { width: road.width, height: road.height, bitmap: Buffer.from(road.bitmap).toString('base64') });
    };
    await copyRoad('bead');
    await page.getByRole('heading', { name: 'Baccarat Live Analyzer', exact: true }).click();
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    await copyRoad('big-road');
    const room = page.getByLabel('이미지 방 이름'); await room.fill('붙여넣기 방');
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('image-detected-count')).toHaveText('37개 결과 인식 추정');
    await expect(room).toHaveValue('붙여넣기 방');
    await copyRoad('bead');
    const sequence = page.getByLabel('이미지 슈'); await sequence.fill('BPT');
    // Exercise the native Edit > Paste route, not a synthetic DOM paste event.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    await expect(sequence).toHaveValue('BPT');
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('P B T'); });
    await sequence.fill(''); await page.keyboard.press('Control+v');
    await expect(sequence).toHaveValue('P B T');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('클립보드에 이미지가 없습니다');
    await expect(page.getByTestId('image-detected-count')).toHaveCount(0);
    const oldReview = await page.evaluate(() => window.analyzer.reviewSequence('BPT'));
    await app.evaluate(async ({ nativeImage, clipboard, ClipboardItem }) => {
      const png = nativeImage.createFromBitmap(Buffer.alloc(80 * 60 * 4, 255), { width: 80, height: 60 }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    });
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-preview-status')).toContainText('이미지 불러오기 완료');
    await expect(page.getByTestId('image-preview-status')).toContainText('자동 인식 실패');
    await expect(page.getByRole('img', { name: '불러온 원본 이미지', exact: true })).toBeVisible();
    await expect(page.getByTestId('image-detected-count')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toHaveCount(0);
    await expect(page.getByTestId('recognition-diagnostics')).toContainText('80×60');
    await expect(page.getByTestId('recognition-diagnostics')).toContainText('원 후보 0개');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.evaluate(reviewId => window.analyzer.saveImage({ reviewId, roomName: 'stale', shoeId: 's', startRound: 1, outcomes: ['B', 'P', 'T'] }), oldReview.id)).rejects.toThrow('다시 읽고');
    expect((await page.evaluate(() => window.analyzer.snapshot())).results).toHaveLength(0);
    await page.screenshot({ path: 'test-results/clipboard-unrecognized.png' });
    await copyRoad('bead');
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    await expect(page.getByTestId('image-preview-status')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await page.evaluate(() => window.analyzer.snapshot())).results).toHaveLength(0);
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/clipboard-dashboard.png' });
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});

test('numeric clipboard records, frozen 22-round picks, O/X rates and rolling predictions', async () => {
  test.setTimeout(90000);
  const folder=mkdtempSync(join(tmpdir(),'baccarat-numeric-')); let app:ElectronApplication|undefined;
  const outcomes=('PBPBTTBPPP BPPBPTPPBTBB'.replaceAll(' ','')).split('') as Array<'B'|'P'|'T'>;
  const points=[5,7,9,2,5,9,6,5,7,7,4,8,8,4,7,6,9,8,2,3,7,6];
  try {
    app=await electron.launch({executablePath:process.env.DESKTOP_TEST_EXECUTABLE,args:['.','--smoke-test',`--test-data=${folder}`,...(process.platform==='linux'&&process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST==='1'?['--no-sandbox']:[])]});
    const page=await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Baccarat Live Analyzer',exact:true})).toBeVisible();
    const copy=async (values:typeof outcomes,scores:number[])=>{
      const encoded=await page.evaluate(({values,scores})=>{
        const canvas=document.createElement('canvas');canvas.width=360;canvas.height=146;
        const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,360,146);
        const pitch=20.5,left=10,top=10;context.strokeStyle='#ddd';context.lineWidth=1;
        for(let row=0;row<=6;row++){context.beginPath();context.moveTo(left,Math.round(top+row*pitch));context.lineTo(Math.round(left+16*pitch),Math.round(top+row*pitch));context.stroke();}
        for(let col=0;col<=16;col++){context.beginPath();context.moveTo(Math.round(left+col*pitch),top);context.lineTo(Math.round(left+col*pitch),Math.round(top+6*pitch));context.stroke();}
        values.forEach((outcome,i)=>{const x=left+(Math.floor(i/6)+0.5)*pitch,y=top+(i%6+0.5)*pitch;context.fillStyle={B:'#fb213c',P:'#2388ff',T:'#04a76c'}[outcome];context.beginPath();context.arc(x,y,9,0,Math.PI*2);context.fill();context.fillStyle='#fff';context.font='bold 14px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText(String(scores[i]),x,y);});
        return canvas.toDataURL('image/png').split(',')[1];
      },{values,scores});
      await app!.evaluate(async({clipboard,ClipboardItem},value)=>{await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(Buffer.from(value,'base64'))],{type:'image/png'})})]);},encoded);
      await page.getByRole('heading',{name:'Baccarat Live Analyzer',exact:true}).click();await page.keyboard.press('Control+v');
      await expect(page.getByTestId('image-detected-count')).toHaveText(`${values.length}개 결과 인식 추정`,{timeout:20000});
    };
    expect(outcomes).toHaveLength(22);await copy(outcomes,points);
    const readPoints=await page.locator('.score-field input').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value));
    expect(readPoints).toHaveLength(22);
    expect(readPoints.filter(Boolean).length).toBeGreaterThan(0);
    // Unknown scores are an explicit supported state. Verify every confident
    // digit against the original, then confirm the unknown fields manually.
    test.info().annotations.push({type:'score-ocr',description:`${readPoints.filter(Boolean).length}/22 fixture scores read; remaining fields require confirmation`});
    for(let i=0;i<22;i++){if(readPoints[i])expect(readPoints[i]).toBe(String(points[i]));else {await expect(page.getByLabel(`이미지 점수 ${i+1}`,{exact:true})).toHaveAttribute('placeholder','미확인');await page.getByLabel(`이미지 점수 ${i+1}`,{exact:true}).fill(String(points[i]));}}
    await page.getByLabel('이미지 슈').fill('numeric-shoe-1');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'확인한 그림판 기록 저장'}).click();
    await expect(page.getByTestId('total-results')).toHaveText('22');
    const original=await page.evaluate(()=>window.analyzer.snapshot());const frozen=original.forecasts.filter(f=>f.cutoffRound===22);
    expect(original.results.map(r=>r.score)).toEqual(points);expect(frozen).toHaveLength(16);
    await expect(page.getByTestId('method-accuracy-A')).toContainText('채점 대기');
    await expect(page.getByTestId('grading-wait')).toContainText('23회차부터');
    await expect(page.getByLabel('예측 기준 회차')).toHaveValue('latest');
    for(let horizon=1;horizon<=4;horizon++)await expect(page.getByTestId(`forecast-row-${horizon}`)).toContainText(String(22+horizon));
    for(const f of frozen)await expect(page.getByTestId(`forecast-${f.method}-${f.horizon}`)).toHaveText(f.pick);
    const next=['B','P','T','B'] as const;await copy([...outcomes,...next],[...points,0,1,8,9]);
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:'확인한 그림판 기록 저장'}).click();
    await expect(page.getByTestId('total-results')).toHaveText('26');
    const updated=await page.evaluate(()=>window.analyzer.snapshot());const graded=updated.forecasts.filter(f=>f.cutoffRound===22);
    expect(graded).toHaveLength(16);expect(graded.every(f=>f.actual&&f.mark===(f.pick===f.actual?'O':'X'))).toBe(true);
    expect(graded.map(({actual,mark,...f})=>f).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(frozen.map(({actual,mark,...f})=>f).sort((a,b)=>a.id.localeCompare(b.id)));
    await expect(page.getByLabel('예측 기준 회차')).toHaveValue('latest');
    await page.getByLabel('예측 기준 회차').selectOption('22');await expect(page.getByTestId('bundle-accuracy-A')).toContainText('50.00%');
    expect(updated.stats.advanceComparisons).toBe(4);expect(updated.results.slice(22).every(r=>!r.historical)).toBe(true);
    await expect(page.getByTestId('method-accuracy-A')).toContainText('50.00%');
    await page.getByTestId('forecast-method-A').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/four-round-graded.png'});
    await page.getByLabel('예측 기준 회차').selectOption('latest');
    await expect(page.getByTestId('latest-mark-A')).toHaveText('O');
    for(let horizon=1;horizon<=4;horizon++)await expect(page.getByTestId(`forecast-row-${horizon}`)).toContainText(String(26+horizon));
    // Include graded horizons 2–4 when no immediate-next-round forecast exists.
    // Batch updates still give one continuous chronological table, not 23→27.
    expect(await page.locator('.forecast-matrix tbody tr[data-round]').evaluateAll(rows=>rows.map(row=>Number((row as HTMLElement).dataset.round)))).toEqual([23,24,25,26,27,28,29,30]);
    await app.close();app=await electron.launch({executablePath:process.env.DESKTOP_TEST_EXECUTABLE,args:['.','--smoke-test',`--test-data=${folder}`,...(process.platform==='linux'&&process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST==='1'?['--no-sandbox']:[])]});
    const reopened=await app.firstWindow();await expect(reopened.getByTestId('total-results')).toHaveText('26');
    expect((await reopened.evaluate(()=>window.analyzer.snapshot())).forecasts.filter(f=>f.cutoffRound===22).every(f=>f.actual)).toBe(true);
  }finally{await app?.close().catch(()=>{});rmSync(folder,{recursive:true,force:true});}
});

test('clipboard preview, correction, confirmation, deduplication and restart persistence', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-image-')); let app: ElectronApplication | undefined;
  const launch = () => electron.launch({
    executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
    args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])],
  });
  try {
    app = await launch(); const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true })).toBeVisible();
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
    await app.evaluate(async ({ clipboard, ClipboardItem }, value) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(Buffer.from(value, 'base64'))], { type: 'image/png' }) })]);
    }, encoded);
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
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
    await page.evaluate(input => window.analyzer.appendManual(input), { roomId: snapshot.roomId!, shoeId: snapshot.shoeId!, round: 18, outcome: 'B' as const });
    await expect(page.getByTestId('total-results')).toHaveText('9');
    const live = await page.evaluate(() => window.analyzer.snapshot());
    expect(live.results.at(-1)).toMatchObject({ round: 18, outcome: 'B', historical: false, source: 'manual' });
    expect(live.stats.comparisons).toBe(1); expect(live.forecasts.filter(f => f.targetRound === 18 && f.horizon === 1).every(f => f.mark === 'O' || f.mark === 'X')).toBe(true);
    await expect(page.evaluate(input => window.analyzer.appendManual(input), { roomId: live.roomId!, shoeId: live.shoeId!, round: 18, outcome: 'P' as const })).rejects.toThrow('다음 회차');
    expect((await page.evaluate(() => window.analyzer.snapshot())).results.at(-1)?.outcome).toBe('B');
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toBeVisible();
    await page.getByLabel('이미지 결과 1', { exact: true }).selectOption('P'); await confirmed.check();
    await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('image-save-status')).toContainText('새 기록 0개');
    await page.screenshot({ path: 'test-results/image-dashboard.png' });
    await app.close(); app = await launch(); const reopened = await app.firstWindow();
    await expect(reopened.getByTestId('total-results')).toHaveText('9');
    expect((await reopened.evaluate(() => window.analyzer.snapshot())).results[0].outcome).toBe('P');
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});

test('Ctrl+V reads a big road without grid lines, with tails and split tie rings', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-circle-road-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])] });
    const page = await app.firstWindow(), road = circleRoadBitmap();
    await app.evaluate(async ({ nativeImage, clipboard, ClipboardItem }, input) => {
      const png = nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    }, { width: road.width, height: road.height, bitmap: Buffer.from(road.bitmap).toString('base64') });
    await page.getByRole('heading', { name: 'Baccarat Live Analyzer', exact: true }).click();
    await page.keyboard.press('Control+v');
    const bp = circleSequence.filter(outcome => outcome !== 'T');
    await expect(page.getByTestId('image-detected-count')).toHaveText(`${bp.length + 2}개 결과 인식 추정`);
    await expect(page.getByTestId('recognition-diagnostics')).toContainText('격자 후보 0개');
    await expect(page.getByTestId('recognition-diagnostics')).toContainText('원의 중심·둘레');
    for (let i = 0; i < bp.length; i++) await expect(page.getByLabel(`이미지 결과 ${i + 1}`, { exact: true })).toHaveValue(bp[i]);
    expect((await page.evaluate(() => window.analyzer.snapshot())).results).toHaveLength(0);
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    await page.getByLabel('이미지 방 이름').fill('원 기반 분석 테스트'); await page.getByLabel('이미지 슈').fill('circle-road-1');
    await page.locator('.tie-field input').nth(0).fill('1'); await page.locator('.tie-field input').nth(1).fill('2');
    await page.getByRole('checkbox').check();
    await page.getByTestId('image-detected-count').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/circle-road-recognized.png' });
    await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText(String(circleSequence.length));
    const snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.results.map(row => row.outcome)).toEqual(circleSequence);
    expect(snapshot.forecasts.filter(f => f.horizon === 1 && f.targetRound === circleSequence.length + 1)).toHaveLength(4);
    expect(snapshot.stats.comparisons).toBe(0);
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});

test('15-round tie review, original/150% zoom and larger text', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-short-tie-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])] });
    const page = await app.firstWindow(), road = shortTieRoadBitmap();
    await app.evaluate(async ({ nativeImage, clipboard, ClipboardItem }, input) => {
      const png = nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    }, { width: road.width, height: road.height, bitmap: Buffer.from(road.bitmap).toString('base64') });
    await page.getByRole('heading', { name: 'Baccarat Live Analyzer', exact: true }).click(); await page.keyboard.press('Control+v');
    await expect(page.getByTestId('image-detected-count')).toHaveText('15개 결과 인식 추정');
    await expect(page.getByTestId('image-tie-summary')).toContainText('B/P 원 14개 + 타이 1회 = 총 15회');
    await expect(page.getByLabel('이미지 타이 결과 13', { exact: true })).toHaveText('T');
    await expect(page.getByTestId('image-round-number').last()).toHaveText('15회차');
    await expect(page.getByLabel('타이 횟수 12', { exact: true })).toHaveValue('1');
    const preview = page.getByRole('img', { name: '붙여넣은 그림판 원본 이미지', exact: true });
    await expect(page.getByRole('button', { name: '확대 150%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(preview).toHaveCSS('width', '391.5px');
    expect(await preview.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(261);
    await page.getByRole('button', { name: '원본 100%', exact: true }).click(); await expect(preview).toHaveCSS('width', '261px');
    await page.getByRole('button', { name: '확대 150%', exact: true }).click(); await expect(preview).toHaveCSS('width', '391.5px');
    expect(await page.locator('.note').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    const confirmed = page.getByRole('checkbox'); await confirmed.check();
    await page.getByLabel('타이 횟수 12', { exact: true }).fill('2'); await expect(confirmed).not.toBeChecked();
    await expect(page.getByTestId('image-detected-count')).toHaveText('16개 결과 인식 추정');
    await expect(page.getByLabel('이미지 타이 결과 14', { exact: true })).toHaveText('T');
    await page.getByLabel('타이 횟수 12', { exact: true }).fill('');
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    await page.getByLabel('타이 횟수 12', { exact: true }).fill('1');
    await page.getByLabel('이미지 슈').fill('short-tie-1'); await confirmed.check();
    await page.getByTestId('image-detected-count').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/short-tie-zoom.png' });
    await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText('15');
    const snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.results.map(row => row.outcome)).toEqual(shortTieSequence);
    expect(snapshot.results[12]).toMatchObject({ round: 13, outcome: 'T' });
    expect(snapshot.forecasts.filter(f => f.horizon === 1 && f.targetRound === 16)).toHaveLength(4);
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});

test('small clipboard grids, missing outer borders, watermark, ties and stored forecasts', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'baccarat-small-road-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.DESKTOP_TEST_EXECUTABLE,
      args: ['.', '--smoke-test', `--test-data=${folder}`, ...(process.platform === 'linux' && process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST === '1' ? ['--no-sandbox'] : [])] });
    const page = await app.firstWindow();
    const bead = smallRoadBitmap('bead', true);
    const png = await app.evaluate(({ nativeImage }, input) => nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG().toString('base64'), { width: bead.width, height: bead.height, bitmap: Buffer.from(bead.bitmap).toString('base64') });
    await app.evaluate(async ({ clipboard, ClipboardItem }, value) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(Buffer.from(value, 'base64'))], { type: 'image/png' }) })]);
    }, png);
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('38개 결과 인식 추정');
    for (let i = 0; i < exampleOutcomes.length; i++) await expect(page.getByLabel(`이미지 결과 ${i+1}`, { exact: true })).toHaveValue(exampleOutcomes[i]);
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText('38');
    const road = smallRoadBitmap('big-road');
    for (const y of [4, 76]) for (let x = 6; x <= 462; x++) road.bitmap.set([255, 255, 255, 255], (y * road.width + x) * 4);
    for (const x of [6, 462]) for (let y = 4; y <= 76; y++) road.bitmap.set([255, 255, 255, 255], (y * road.width + x) * 4);
    for (let x = 310; x < 410; x++) road.bitmap.set([180, 180, 180, 255], (60 * road.width + x) * 4);
    await app.evaluate(async ({ nativeImage, clipboard, ClipboardItem }, input) => {
      const png = nativeImage.createFromBitmap(Buffer.from(input.bitmap, 'base64'), { width: input.width, height: input.height }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    }, { width: road.width, height: road.height, bitmap: Buffer.from(road.bitmap).toString('base64') });
    await page.getByRole('button', { name: '클립보드 이미지 붙여넣기 (Ctrl+V)', exact: true }).click();
    await expect(page.getByTestId('image-detected-count')).toHaveText('37개 결과 인식 추정');
    await expect(page.getByRole('button', { name: '확인한 그림판 기록 저장' })).toBeDisabled();
    const markers = page.locator('.tie-field input'); await expect(markers).toHaveCount(2);
    await markers.nth(0).fill('1'); await markers.nth(1).fill('2');
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '확인한 그림판 기록 저장' }).click();
    await expect(page.getByTestId('total-results')).toHaveText('38');
    const snapshot = await page.evaluate(() => window.analyzer.snapshot());
    expect(snapshot.results.map(row => row.outcome)).toEqual(exampleOutcomes); expect(snapshot.stats.counts).toEqual({ B: 19, P: 16, T: 3 });
    await page.screenshot({ path: 'test-results/small-road-dashboard.png' });
    expect(snapshot.forecasts.filter(f => f.targetRound === 39 && f.horizon === 1)).toHaveLength(4);
    expect(snapshot.stats.comparisons).toBe(0);
    await expect(page.getByRole('button', { name: '플레이어 결과 기록', exact: true })).toHaveCount(0);
  } finally { await app?.close().catch(() => {}); rmSync(folder, { recursive: true, force: true }); }
});
