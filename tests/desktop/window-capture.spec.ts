import { _electron as electron,test,expect,type ElectronApplication } from '@playwright/test';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('board-only native capture uses 2x pixels without room/counter text, supports dragging and preserves O/X',async()=>{
  test.setTimeout(90000);
  const folder=mkdtempSync(join(tmpdir(),'baccarat-capture-'));let app:ElectronApplication|undefined;
  try{
    app=await electron.launch({executablePath:process.env.DESKTOP_TEST_EXECUTABLE,args:['.','--smoke-test',`--test-data=${folder}`,
      ...(process.platform==='linux'&&process.env.ALLOW_UNSANDBOXED_FIXTURE_TEST==='1'?['--no-sandbox']:[])]});
    const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'Baccarat Live Analyzer'})).toBeVisible();
    await app.evaluate(async({BrowserWindow})=>{
      const fixture=new BrowserWindow({width:900,height:650,x:0,y:0,useContentSize:true,frame:false,title:'Baccarat Capture Fixture',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
      await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>Baccarat Capture Fixture</title><body style="margin:0;background:#18344b;font-family:Arial"><canvas id="board" width="350" height="80" style="position:absolute;left:10px;top:550px"></canvas></body>'));
    });
    await expect.poll(()=>app!.windows().some(p=>p.url().startsWith('data:text/html'))).toBe(true);
    const game=app.windows().find(p=>p.url().startsWith('data:text/html'))!;
    const paint=async(outcomes:string)=>game.evaluate(outcomes=>{
      const canvas=document.getElementById('board') as HTMLCanvasElement,ctx=canvas.getContext('2d')!;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,350,80);ctx.strokeStyle='#d0d0d0';ctx.lineWidth=1;
      for(let x=3;x<=339;x+=12){ctx.beginPath();ctx.moveTo(x+.5,2);ctx.lineTo(x+.5,74);ctx.stroke();}
      for(let y=2;y<=74;y+=12){ctx.beginPath();ctx.moveTo(3,y+.5);ctx.lineTo(339,y+.5);ctx.stroke();}
      [...outcomes].forEach((o,i)=>{const x=9.5+Math.floor(i/6)*12,y=8.5+(i%6)*12;ctx.fillStyle=o==='B'?'#f22':o==='P'?'#2785ff':'#009b5c';ctx.beginPath();ctx.arc(x,y,5.2,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.font='bold 8px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i%10),x,y+.5);});
    },outcomes);
    const aHistory='BPBPBBPPTBBPPBPBBPPBPP';await paint(aHistory);
    await game.locator('#board').screenshot();
    await page.getByRole('button',{name:'게임 창 선택',exact:true}).click();
    const select=page.getByLabel('자동 가져올 게임 창');await expect(select).toBeVisible();
    const sourceId=await select.locator('option').filter({hasText:'Baccarat Capture Fixture'}).getAttribute('value');expect(sourceId).toBeTruthy();await select.selectOption(sourceId!);
    await page.getByRole('button',{name:'자동 가져오기 시작',exact:true}).click();
    await expect(page.getByTestId('capture-preview')).toBeVisible();
    await expect(page.getByTestId('capture-status')).toContainText('22개 결과 수집',{timeout:25000});
    await expect(page.getByTestId('total-results')).toHaveText('22');
    const initial=await page.evaluate(()=>window.analyzer.snapshot());expect(initial.results.every(r=>r.historical)).toBe(true);
    const before=await page.evaluate(()=>window.analyzer.captureInfo());
    expect(before.recognitionScale).toBe(2);
    await page.locator('.capture-preview').evaluate(el=>{(el as HTMLDetailsElement).open=true;});
    const preview=page.getByTestId('capture-preview');
    await page.getByRole('button',{name:'원본 100%',exact:true}).click();
    await expect.poll(()=>preview.evaluate(el=>(el as HTMLImageElement).complete)).toBe(true);
    const originalWidth=await preview.evaluate(el=>(el as HTMLImageElement).naturalWidth);
    await page.getByRole('button',{name:'2배 200%',exact:true}).click();
    await expect.poll(()=>preview.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(originalWidth);
    const doubledWidth=await preview.evaluate(el=>(el as HTMLImageElement).naturalWidth);
    expect(Math.abs(doubledWidth-originalWidth*2)).toBeLessThanOrEqual(2);
    const viewport=page.getByTestId('capture-viewport');
    await viewport.evaluate(el=>{el.style.width='320px';});
    const imageBox=(await viewport.boundingBox())!;
    await page.mouse.move(imageBox.x+220,imageBox.y+40);await page.mouse.down();
    await page.mouse.move(imageBox.x+110,imageBox.y+40);await page.mouse.up();
    await expect.poll(()=>viewport.evaluate(el=>el.scrollLeft)).toBeGreaterThan(60);
    const windowBounds=()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Baccarat Live Analyzer')!.getBounds());
    const originalBounds=await windowBounds();
    const header=(await page.getByLabel('프로그램 창 이동').boundingBox())!;
    await page.mouse.move(header.x+250,header.y+20);await page.mouse.down();
    await page.mouse.move(header.x+290,header.y+45);await page.mouse.up();
    await expect.poll(async()=>{const moved=await windowBounds();return {x:moved.x-originalBounds.x,y:moved.y-originalBounds.y};}).toEqual({x:40,y:25});
    await paint(aHistory+'B');
    await expect(page.getByTestId('capture-status')).toContainText('23개 결과 수집',{timeout:20000});
    await expect(page.getByTestId('total-results')).toHaveText('23');
    const scored=await page.evaluate(()=>window.analyzer.snapshot());expect(scored.stats.advanceAccuracy.A.count).toBe(1);expect(scored.stats.advanceAccuracy.A.rate).toBe(1);
    await expect(page.getByTestId('method-accuracy-A')).toContainText('100.00%');
    await expect(page.getByTestId('latest-mark-A')).toHaveText('O');
    expect(scored.forecasts.filter(f=>f.cutoffRound===22).map(f=>f.id)).toEqual(initial.forecasts.map(f=>f.id));
    expect((await page.evaluate(()=>window.analyzer.captureInfo())).capturedAt).not.toBe(before.capturedAt);
    const bHistory='PPPTBPBBPTB';await paint(bHistory);
    await expect(page.getByTestId('capture-status')).toContainText('그림판 2 · 11개 결과 수집',{timeout:20000});
    await expect(page.getByTestId('total-results')).toHaveText('11');
    const b=await page.evaluate(()=>window.analyzer.snapshot());expect(b.roomId).not.toBe(initial.roomId);expect(b.results.map(r=>r.outcome).join('')).toBe(bHistory);expect(b.stats.advanceComparisons).toBe(0);
    const preserved=await page.evaluate(({room,shoe})=>window.analyzer.snapshot(room,shoe),{room:initial.roomId!,shoe:initial.shoeId!});expect(preserved.results).toHaveLength(23);
    await page.screenshot({path:'test-results/automatic-capture.png'});
    await paint('');
    await expect(page.getByTestId('capture-status')).toContainText('빈 그림판 · 첫 결과 대기',{timeout:15000});
    await paint('T');
    await expect(page.getByTestId('capture-status')).toContainText('1개 결과 수집',{timeout:15000});
    await expect(page.getByTestId('total-results')).toHaveText('1');
    const newShoe=await page.evaluate(()=>window.analyzer.snapshot());expect(newShoe.shoeId).not.toBe(b.shoeId);
    expect((await page.evaluate(({room,shoe})=>window.analyzer.snapshot(room,shoe),{room:b.roomId!,shoe:b.shoeId!})).results).toHaveLength(11);
    await page.getByRole('button',{name:'자동 가져오기 중지',exact:true}).click();expect((await page.evaluate(()=>window.analyzer.captureInfo())).enabled).toBe(false);
  }catch(error){
    if(app){const page=await app.firstWindow();mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-capture-failure.png'}).catch(()=>{});
      const info=await page.evaluate(()=>window.analyzer.captureInfo()).catch(()=>null);
      if(info?.preview)writeFileSync('test-results/native-capture-input.png',Buffer.from(info.preview.split(',')[1],'base64'));}
    throw error;
  }finally{if(app)await app.close();rmSync(folder,{recursive:true,force:true});}
});
