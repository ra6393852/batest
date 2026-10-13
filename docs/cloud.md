# Linux 클라우드 개발·검증

0.4.6은 큰 글씨·원본 100%/150% 보기와 타이 포함 회차/총개수 표시를 추가했습니다. Linux 단위82개·Electron6개 통과. Windows 소스/무설치 EXE는 Chrome 모듈 포함 각각7개를 실행합니다. 빅로드 초록 표시마다 T1회 기본값을 제안하고 전체 확인 전에는 저장하지 않습니다. 타이 수정은 표시와 저장에 같은 확장 함수를 사용합니다. 이미지 확대는 보기만 바꾸고 원본 인식 픽셀을 변경하지 않습니다.

0.4.5는 원 중심·둘레 기반 빅로드 인식과 실패 단계별 진단을 추가했습니다. `bash scripts/test-cloud.sh`의 단위 78개와 Linux Electron 5개 테스트가 통과했습니다. Windows CI는 소스/무설치 EXE에서 Chrome 모듈을 포함해 각각 6개를 실행합니다. 사용자 첨부 원본 대신 격자 없는 원/초록 사선/쌍/소수점 간격/꺾임 재현 fixture를 사용했습니다.

0.4.4의 기본 UI는 클립보드 입력 전용입니다. Linux 검증은 단위 테스트 70개와 Electron 4개이며, Windows CI는 소스와 압축 해제한 무설치 EXE에서 내부 Chrome 모듈을 포함해 각각 5개를 검사합니다. Chrome 서버는 명시적 `--enable-chrome-bridge` 개발 실행에서만 시작합니다. 아래 버전별 UI/검증 설명은 과거 기록입니다.

0.4.2의 Windows 배포는 무설치 ZIP입니다. `npm run dist:win`은 x64 ZIP을 만들고, Windows CI는 압축을 푼 EXE에서 5개 데스크톱 테스트를 실행합니다. 현재 Linux 검증은 단위 테스트 64개와 Electron 테스트 4개입니다. 아래 버전별 설치 EXE/NSIS 설명은 과거 검증 기록입니다.

선택된 `/workspace/batest` 체크아웃을 그대로 사용합니다. 클라우드 작업은 이미 격리돼 있으므로 별도의 Git worktree를 만들지 않습니다.

```bash
bash scripts/setup-cloud.sh
bash scripts/test-cloud.sh
```

설치 스크립트는 고정 lockfile의 `npm ci`, 공식 체크섬으로 Electron 다운로드, TypeScript/React 빌드를 수행합니다. 필요한 경우 서명 검증된 Debian trixie 저장소에서 Xvfb를 내려받아 `/workspace/.cache/desktop-runtime`에 풉니다. 시스템 경로를 수정하거나 루트 설치를 하지 않습니다. 캐시는 `/workspace/.cache` 아래에 두며 설치 스크립트에 비밀값을 저장하지 않습니다.

이 클라우드 컨테이너는 사용자 네임스페이스를 중첩 생성할 수 없어 Chromium의 Linux OS sandbox가 시작되지 않습니다. **로컬 fixture 전용** 데스크톱 테스트는 `ALLOW_UNSANDBOXED_FIXTURE_TEST=1`과 `--smoke-test`로 실행합니다. 이 모드에서는 실제 사이트를 열 수 없고 테스트 DB/세션을 따로 사용합니다. 일반 앱 실행에 `--no-sandbox`를 추가하지 마세요. 파일 sandbox, TLS, 패키지 서명/체크섬 검증은 그대로 유지합니다.

0.2.0의 cloud 테스트는 단위 테스트 37개와 Electron fixture 테스트를 실행합니다. 시스템 Chromium 154의 확장 시작은 이 컨테이너에서 실패하고 Playwright가 맞춘 Chrome 145 다운로드는 네트워크 정책으로 차단돼, Chrome 확장 연결·재연결은 Windows CI의 실제 Chrome for Testing에서 검증합니다. 이를 Linux에서 통과했다고 표시하지 않습니다. Windows CI는 소스 앱과 설치된 EXE 모두에서 Electron 및 Chrome 확장 테스트를 실행합니다.

파일·의존성은 환경 스냅샷에 남지만 Xvfb와 Electron 프로세스는 남지 않습니다. 테스트 스크립트가 자기 Xvfb를 새로 시작하고 종료합니다. 실제 앱 사용은 Windows에서 `npm start` 또는 설치 EXE로 수행합니다. Linux 패키지는 개발 검증용이며 배포 대상이 아닙니다.

Windows 앱 파일 교차 패키징은 성공했으나 NSIS 설치 EXE 생성은 이 Linux 환경에서 완료되지 않았습니다. 시스템 Wine이 없어 electron-builder의 공식 `toolsets.wine=1.0.1`(Wine 11)을 체크섬 검증 후 시도했지만 DLL 로딩이 실패했습니다. 이 단계는 Windows GitHub Actions 또는 Windows PC의 `npm run dist:win`에서 검증해야 합니다. 완성되지 않은 설치 EXE는 배포하지 않습니다.

필수 네트워크는 npm registry, GitHub 및 공식 릴리스 자산, Debian 패키지 저장소입니다. 실제 사이트 검증에는 `box-1515.com`의 접근 허용과 이후 확인된 제공자 출처가 필요합니다. PR 생성에는 `api.github.com` 접근과 저장소 PR 쓰기 권한이 필요합니다. 현재 권한을 우회하거나 GitHub 토큰을 소스/로그에 저장하지 않습니다.
# 0.3.0 이미지 테스트

`bash scripts/test-cloud.sh`는 53개 단위 테스트, 빌드, Electron 테스트 2개(`app.spec.ts`, `image-import.spec.ts`)를 실행합니다. 이미지 테스트에는 사이트 로그인이나 Chrome 연결이 필요 없습니다. Chrome 팝업·iframe 통합 테스트는 Windows CI에서 실행합니다. Windows CI는 설치 EXE에서도 이미지 테스트와 패키지 안의 Chrome 확장을 검사합니다.

## 0.4.0 검증

현재 `bash scripts/test-cloud.sh`는 64개 단위 테스트와 Linux Electron 테스트 3개를 실행합니다. 작은 격자 파일·클립보드 입력, 빅로드 타이 확인, 직접 입력·시뮬레이션·수동 새 결과 채점이 포함됩니다. Windows CI는 소스와 설치본에서 Chrome 테스트를 포함한 4개를 각각 실행합니다.
