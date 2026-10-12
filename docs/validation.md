# 검증 기록

검증일: 2026-10-13 (한국 시간). 실제 게임의 예측 우위는 아직 입증되지 않았습니다.

| 검사 | 결과와 범위 |
| --- | --- |
| `bash scripts/setup-cloud.sh` | 성공. `npm ci`, 공식 체크섬 Electron 설치, 타입 검사와 Vite/main/preload/OCR worker 빌드 |
| `npm test` | 31개 실행·통과, 0개 실패/스킵 |
| `bash scripts/test-cloud.sh` | Electron 통합 테스트 1개 실행·통과. 자동 DOM 수집, 방/슈 분리, 타이, 사전 채점, 재실행 복원, 원격 Node/API 격리, 로컬 이미지 OCR |
| Linux 패키징 | 성공. 실제 패키징된 Electron 앱에서도 통합 테스트 1개 통과. `resources/ocr` worker/언어 모델 사용 |
| `npm audit --omit=dev --audit-level=high` | production 의존성 취약점 0개 |
| 사이트 공개 페이지 | 처음 프록시 403. 네트워크 설정 변경 후 공식 HTTPS GET 200, 제목 BOX 확인 |
| 실제 사이트 Electron 접속·로그인·게임 수집 | 미실행/미검증. Windows에서 사용자가 직접 로그인하고 허용된 어댑터 검증 필요 |
| 색상 그림장 CV 및 실제 사이트 OCR | 미구현 또는 미검증. OCR 테스트는 로컬 이미지 BANKER 텍스트에 한정 |
| Windows 앱 파일 교차 패키징 | 성공, `win-unpacked` 생성 |
| Linux에서 Windows NSIS 설치 파일 | 실패. 시스템 Wine 부재 진단 후 공식 Wine 11 toolset 시도, DLL 로딩 오류 발생. 체크섬/TLS 검증은 유지했으며 미완성 설치 EXE는 배포하지 않음 |
| Windows GitHub Actions / 설치·실행 | CI 결과는 PR에서 확인. Windows PC에서 실제 사이트 로그인·설치 테스트는 별도 필요 |

Linux의 `--no-sandbox`는 컨테이너 사용자 네임스페이스 제한 때문에 로컬 fixture 전용 테스트에서만 사용합니다. 해당 `--smoke-test`는 실제 사이트 접속을 거절하고 테스트 전용 DB/세션을 사용합니다. Windows 및 일반 앱 실행에는 적용하지 않습니다.

시험 데이터의 높은 적중률을 실제 게임 정확도로 표현하지 않습니다. 통계는 동일 목표 회차에서 사전에 저장한 A/B/C/D 분포를 비교하며, 과거 데이터의 사후 맞추기는 제외합니다.
