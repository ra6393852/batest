# Linux 클라우드 개발·검증

선택된 `/workspace/batest` 체크아웃을 그대로 사용합니다. 클라우드 작업은 이미 격리돼 있으므로 별도의 Git worktree를 만들지 않습니다.

```bash
bash scripts/setup-cloud.sh
bash scripts/test-cloud.sh
```

설치 스크립트는 고정 lockfile의 `npm ci`, 공식 체크섬으로 Electron 다운로드, TypeScript/React 빌드를 수행합니다. 필요한 경우 서명 검증된 Debian trixie 저장소에서 Xvfb를 내려받아 `/workspace/.cache/desktop-runtime`에 풉니다. 시스템 경로를 수정하거나 루트 설치를 하지 않습니다. 캐시는 `/workspace/.cache` 아래에 두며 설치 스크립트에 비밀값을 저장하지 않습니다.

이 클라우드 컨테이너는 사용자 네임스페이스를 중첩 생성할 수 없어 Chromium의 Linux OS sandbox가 시작되지 않습니다. **로컬 fixture 전용** 데스크톱 테스트는 `ALLOW_UNSANDBOXED_FIXTURE_TEST=1`과 `--smoke-test`로 실행합니다. 이 모드에서는 실제 사이트를 열 수 없고 테스트 DB/세션을 따로 사용합니다. 일반 앱 실행과 Windows CI에 `--no-sandbox`를 추가하지 마세요. 파일 sandbox, TLS, 패키지 서명/체크섬 검증은 그대로 유지합니다.

파일·의존성은 환경 스냅샷에 남지만 Xvfb와 Electron 프로세스는 남지 않습니다. 테스트 스크립트가 자기 Xvfb를 새로 시작하고 종료합니다. 실제 앱 사용은 Windows에서 `npm start` 또는 설치 EXE로 수행합니다. Linux 패키지는 개발 검증용이며 배포 대상이 아닙니다.

Windows 앱 파일 교차 패키징은 성공했으나 NSIS 설치 EXE 생성은 이 Linux 환경에서 완료되지 않았습니다. 시스템 Wine이 없어 electron-builder의 공식 `toolsets.wine=1.0.1`(Wine 11)을 체크섬 검증 후 시도했지만 DLL 로딩이 실패했습니다. 이 단계는 Windows GitHub Actions 또는 Windows PC의 `npm run dist:win`에서 검증해야 합니다. 완성되지 않은 설치 EXE는 배포하지 않습니다.

필수 네트워크는 npm registry, GitHub 및 공식 릴리스 자산, Debian 패키지 저장소입니다. 실제 사이트 검증에는 `box-1515.com`의 접근 허용과 이후 확인된 제공자 출처가 필요합니다. PR 생성에는 `api.github.com` 접근과 저장소 PR 쓰기 권한이 필요합니다. 현재 권한을 우회하거나 GitHub 토큰을 소스/로그에 저장하지 않습니다.
