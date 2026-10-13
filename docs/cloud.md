# Linux 클라우드 개발·검증

/workspace/batest의 기존 체크아웃을 사용합니다. 별도의 Git worktree를 만들지 않습니다.

```bash
bash scripts/setup-cloud.sh
bash scripts/test-cloud.sh
```

Node.js 24, 고정 lockfile의 npm ci, 공식 체크섬/TLS를 유지하는 Electron 다운로드와 TypeScript/React 빌드를 사용합니다. 캐시는 `/workspace/.cache`입니다. 정상 의존성은 불필요하게 재설치하지 않습니다. setup 스크립트는 필요한 경우 서명된 Debian trixie Xvfb 패키지를 캐시 안에 풀며 시스템 경로를 수정하지 않습니다.

0.5.0 검증은 단위91개와 Linux Electron8개 대상입니다. 실제 OS 클립보드, 숫자 판독/미확인 점수 수정, 4회차 고정 예측/O/X, SQLite v1→v2 이관 및 보존, 원본 확대, 게임 창의 native desktopCapturer 캡처·실시간 이미지 갱신·자동 방 이동을 검사합니다. 캡처 fixture는 로컬 BrowserWindow의 숫자 그림판이며 실제 Evolution 화면이 아닙니다. Windows CI는 Chrome 확장 내부 테스트를 포함해 소스와 무설치 EXE에서 각각9개를 실행합니다.

창 열거/캡처 검사에는 Xvfb와 X11 창 관리자 xfwm4, dbus-run-session을 사용합니다. 이 환경에는 xfwm4/dbus가 준비되어 있습니다. 테스트 스크립트는 별도 DISPLAY와 DBus 세션을 시작·종료하고 설정 파일을 `/workspace/.cache/baccarat-test-config`에 둡니다. 사용자 HOME을 변경하지 않습니다. 다른 Linux 이미지에서는 이 런타임이 있는지 확인하세요. 프로세스는 환경 스냅샷에 남지 않습니다.

컨테이너의 중첩 사용자 네임스페이스 제한 때문에 Chromium의 Linux OS sandbox를 시작할 수 없습니다. **로컬 fixture 전용** 테스트만 ALLOW_UNSANDBOXED_FIXTURE_TEST=1 및 --smoke-test/--no-sandbox로 실행합니다. 이 모드는 실제 사이트 탐색을 거절하고 임시 DB/세션을 사용합니다. 일반 앱의 sandbox/TLS/서명 검증을 해제하지 않습니다.

기본 사용은 Chrome에서 직접 게임 실행 → 게임 창 선택 → 자동 가져오기 시작입니다. 1초마다 선택한 창의 왼쪽 아래 이미지를 PC 안에서 가져오고 OCR은 별도로 순차 처리합니다. 기본 Chrome 연결 서버/확장 설치는 필요 없습니다. 기존 연결 모듈은 --enable-chrome-bridge 개발 실행에만 사용합니다. 시스템 Chromium 확장 시작/다운로드 제약 때문에 Chrome 확장 통합 테스트는 Windows CI에서 실행하며 Linux 통과로 보고하지 않습니다.

배포는 Windows 무설치 ZIP 전체입니다. EXE와 resources를 함께 유지하고 기존 userData SQLite를 보존합니다. 설치 파일·프로토콜 자동 등록을 포함하지 않습니다. npm run dist:win은 release/Baccarat-Live-Analyzer-0.5.0-x64-Portable.zip을 만들며 CI가 압축 해제한 실제 EXE를 테스트한 뒤 폴더 전체를 아티팩트로 제공합니다.

자동 캡처는 제공된 Evolution 배치 기준의 창 왼쪽42%/아래45%입니다. 방 이름은 왼쪽 위, 전체 결과 수는 오른쪽 아래에서 읽습니다. 화면 보호/최소화/다른 배치와 실제 사이트 판독은 미검증입니다. 이미지·민감한 세션 정보는 저장/로그하지 않고 PC 내 OCR 모델(eng+kor)을 사용합니다. 전체 결과 수/비드로드 개수가 다르면 보류하며 보이지 않는 기록을 임의 복원하지 않습니다. 자동 베팅·접근 정책 우회 기능은 없습니다.
