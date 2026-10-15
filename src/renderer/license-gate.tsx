import React,{useEffect,useState} from 'react';
import type {LicenseStatus} from '../shared/types';
export function LicenseGate({review,children}:{review:React.ReactNode;children:React.ReactNode}){
  const [status,setStatus]=useState<LicenseStatus>(),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[manage,setManage]=useState(false);
  useEffect(()=>{void window.analyzer.licenseStatus().then(setStatus).catch(()=>setError('인증 상태 확인 실패. 프로그램을 다시 실행하세요.'));return window.analyzer.onLicense(setStatus);},[]);
  async function run(fn:()=>Promise<LicenseStatus>){setBusy(true);setError('');try{const result=await fn();setStatus(result);if(result.allowed)setCode('');}catch(error){setError(error instanceof Error?error.message:'인증 처리 실패');}finally{setBusy(false);}}
  if(status?.mode==='review')return <>{review}</>;
  const details=<><p data-testid="license-message">{status?.message??'인증 상태 확인 중…'}</p>{status?.licenseId&&<p>이용권 ID: <span data-testid="license-id">{status.licenseId}</span></p>}{status?.expiresAt&&<p>만료: <b data-testid="license-expiry">{new Date(status.expiresAt).toLocaleString('ko-KR')}</b></p>}{error&&<p role="alert">{error}</p>}</>;
  if(status?.allowed)return <>{children}<button className="license-manage secondary" onClick={()=>setManage(true)}>이용권·PC 등록</button>{manage&&<div className="license-overlay"><section className="access-card" role="dialog" aria-label="이용권 등록 정보"><h2>이용권 · 이 PC 등록</h2>{details}<p>PC 1대에 등록되어 있습니다. 등록 해제 시 분석을 중지하며 기존 기록과 남은 이용 기간은 보존됩니다.</p><button disabled={busy} onClick={()=>void run(()=>window.analyzer.refreshLicense())}>인증 새로 확인</button><button className="secondary" disabled={busy} onClick={()=>void run(()=>window.analyzer.deactivateLicense())}>이 PC 등록 해제</button><button className="secondary" onClick={()=>setManage(false)}>닫기</button></section></div>}</>;
  return <div className="access-screen"><form className="access-card" onSubmit={e=>{e.preventDefault();void run(()=>window.analyzer.activateLicense(code));}}>
    <span className="eyebrow">판매용 이용권 인증</span><h1>Baccarat <span>Live Analyzer</span></h1>{details}
    <p>판매자에게 받은 이용 코드를 등록하세요. 처음 등록한 PC 1대에서 선택한 기간 동안 사용할 수 있습니다. 인터넷 인증이 필요합니다.</p>
    <label>이용 코드<input autoFocus aria-label="이용 코드" autoComplete="off" spellCheck={false} maxLength={100} placeholder="BLA-…" value={code} onChange={e=>setCode(e.target.value)}/></label>
    <button disabled={busy||!status||!code}>{busy?'인증 중…':'이 PC에 등록'}</button><button type="button" className="secondary" disabled={busy||!status} onClick={()=>void run(()=>window.analyzer.refreshLicense())}>기존 등록 다시 확인</button>
    {status?.licenseId&&<button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>window.analyzer.deactivateLicense())}>이 PC 등록 해제</button>}
  </form></div>;
}
