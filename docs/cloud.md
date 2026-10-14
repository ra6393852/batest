# Linux 클라우드 개발·검증

/workspace/batest의 기존 체크아웃을 사용합니다. 별도의 Git worktree를 만들지 않습니다.

```bash
bash scripts/setup-cloud.sh
bash scripts/test-cloud.sh
```

Node.js 24, 고정 lockfile의 npm ci, 공식 체크섬/TLS를 유지하는 Electron 다운로드와 TypeScript/React 빌드를 사용합니다. 캐시는 `/workspace/.cache`입니다. 정상 의존성은 불필요하게 재설치하지 않습니다. setup 스크립트는 필요한 경우 서명된 Debian trixie Xvfb 패키지를 캐시 안에 풀며 시스템 경로를 수정하지 않습니다.

0.5.4 검증은 단위99개와 Linux Electron8개 대상입니다. 실제 OS 클립보드, 숫자 판독/미확인 점수 수정, 4회차 고정 예측/O/X, SQLite v1→v2 이관 및 보존, 원본 확대를 검사합니다. 게임 창의 native desktopCapturer로 방 이름/회차 텍스트가 없는 작은 숫자 그림판을 2배 판독하고 쌍 표시가 있는22→23→24개 결과를 각각5초 이내 저장/채점, 다른 그림판의 새 기록 분리, 빈 그림판 초기화, 100%/200% 미리보기 및 이미지/창 드래그를 검사합니다. 캡처 fixture는 로컬 BrowserWindow이며 실제 Evolution 화면이 아닙니다. Windows CI는 Chrome 확장 내부 테스트를 포함해 소스와 무설치 EXE에서 각각9개를 실행합니다.

창 열거/캡처 검사에는 Xvfb와 X11 창 관리자 xfwm4, dbus-run-session을 사용합니다. 이 환경에는 xfwm4/dbus가 준비되어 있습니다. 테스트 스크립트는 별도 DISPLAY와 DBus 세션을 시작·종료하고 설정 파일을 `/workspace/.cache/baccarat-test-config`에 둡니다. 사용자 HOME을 변경하지 않습니다. 다른 Linux 이미지에서는 이 런타임이 있는지 확인하세요. 프로세스는 환경 스냅샷에 남지 않습니다.

컨테이너의 중첩 사용자 네임스페이스 제한 때문에 Chromium의 Linux OS sandbox를 시작할 수 없습니다. **로컬 fixture 전용** 테스트만 ALLOW_UNSANDBOXED_FIXTURE_TEST=1 및 --smoke-test/--no-sandbox로 실행합니다. 이 모드는 실제 사이트 탐색을 거절하고 임시 DB/세션을 사용합니다. 일반 앱의 sandbox/TLS/서명 검증을 해제하지 않습니다.

기본 사용은 Chrome에서 직접 게임 실행 → 게임 창 선택 → 자동 가져오기 시작입니다. 1초마다 선택한 창의 왼쪽 아래 이미지를 PC 안에서 가져오고 OCR은 별도로 순차 처리합니다. 기본 Chrome 연결 서버/확장 설치는 필요 없습니다. 기존 연결 모듈은 --enable-chrome-bridge 개발 실행에만 사용합니다. 시스템 Chromium 확장 시작/다운로드 제약 때문에 Chrome 확장 통합 테스트는 Windows CI에서 실행하며 Linux 통과로 보고하지 않습니다.

배포는 Windows 무설치 ZIP 전체입니다. EXE와 resources를 함께 유지하고 기존 userData SQLite를 보존합니다. 설치 파일·프로토콜 자동 등록을 포함하지 않습니다. npm run dist:win은 release/Baccarat-Live-Analyzer-0.5.4-x64-Portable.zip을 만들며 CI가 압축 해제한 실제 EXE를 테스트한 뒤 폴더 전체를 아티팩트로 제공합니다.

자동 캡처는 제공된 Evolution 배치 기준의 창 왼쪽42%/아래45%입니다. 방 이름/전체 결과 수는 읽지 않습니다. 캡처 BGRA 픽셀을 정확히 2배 복제하여 판독하고 그림판 부분만 원본/2배 PNG로 미리보기 합니다. 이미지·민감한 세션 정보는 저장/로그하지 않으며 숫자 OCR은 PC 내 영문 모델을 사용합니다. 기록 번호는 보이는 그림판의 상대 순서이며 전체 슈 복원이 아닙니다. 그림판 변경은 새 그룹으로 분리하되, 서로 다른 방의 동일한 그림판은 새 그림판 기록 버튼으로 구분합니다. 화면 보호/최소화/다른 배치와 실제 사이트 판독은 미검증입니다. 자동 베팅·접근 정책 우회 기능은 없습니다.

0.5.3 승패 경로는 숫자 OCR을 await하지 않습니다. background-scores.ts는 실행1개/최신대기1개 큐로 점수를 처리하며 개별 숫자 재시도를 생략합니다. 이미 저장된 승패에 확실한 점수만 추가하고 기존 예측/채점을 바꾸지 않습니다. 작은 분리된 모서리 쌍 성분은 색 투표에서 제외하지만 본체 충돌과92% 기준은 유지합니다. frame-color.test.ts의43개 재현 이미지와 background-scores.test.ts의 끝나지 않는 숫자 작업/취소/예측 불변성을 검사합니다.

0.5.4는 실제 실행 버전을captureInfo의appVersion으로 제공하고, 중복 실행으로 새 버전을 시작하지 못하면 종료 안내를 표시합니다. smoke중복실행은 콘솔만 출력해 같은 분기/문구를 검사합니다. 판독 대기 또는 현재room/shoe/rounds와snapshot이 다르면 이전 기준 제목/선택을 숨깁니다.33개 사진 재현과1→보류33→확정33→34 자동 갱신/채점도 검사합니다.
