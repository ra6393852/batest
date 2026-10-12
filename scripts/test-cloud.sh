#!/usr/bin/env bash
set -euo pipefail
cd /workspace/batest
export npm_config_cache=/workspace/.cache/npm
export XDG_CACHE_HOME=/workspace/.cache
npm test
npm run build
xvfb_binary=$(command -v Xvfb || true)
if [ -z "$xvfb_binary" ]; then xvfb_binary=/workspace/.cache/desktop-runtime/usr/bin/Xvfb; fi
display_file=$(mktemp)
"$xvfb_binary" -displayfd 3 -screen 0 1600x1100x24 -nolisten tcp -ac 3> "$display_file" > /tmp/baccarat-xvfb.log 2>&1 &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true; rm -f "$display_file"' EXIT
for attempt in {1..40}; do
  if [ -s "$display_file" ]; then break; fi
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then cat /tmp/baccarat-xvfb.log; exit 1; fi
  sleep 0.1
done
if [ ! -s "$display_file" ]; then cat /tmp/baccarat-xvfb.log; exit 1; fi
export DISPLAY=":$(cat "$display_file")"
# Only the local fixture test uses this Linux container workaround.
# --smoke-test rejects site navigation. Production launches retain Chromium sandbox.
export ALLOW_UNSANDBOXED_FIXTURE_TEST=1
# The installed system Chromium is newer than this Playwright runtime and fails
# extension startup in this container. Chrome integration runs on Windows CI
# with Playwright's matched Chrome for Testing, alongside the installed EXE.
npx --no-install playwright test app.spec.ts
