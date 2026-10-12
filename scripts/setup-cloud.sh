#!/usr/bin/env bash
set -euo pipefail
cd /workspace/batest
export npm_config_cache=/workspace/.cache/npm
export electron_config_cache=/workspace/.cache/electron
export XDG_CACHE_HOME=/workspace/.cache
export ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder
export NODE_USE_ENV_PROXY=1
npm ci --no-audit --no-fund
npm run setup:electron
npm run build
if ! command -v Xvfb >/dev/null && [ ! -x /workspace/.cache/desktop-runtime/usr/bin/Xvfb ]; then
  apt_dir=/workspace/.cache/desktop-apt
  mkdir -p "$apt_dir/lists/partial" "$apt_dir/archives/partial" "$apt_dir/debs" /workspace/.cache/desktop-runtime
  printf '%s\n' 'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' > "$apt_dir/sources.list"
  printf '%s\n' '#clear APT::Update::Post-Invoke;' '#clear APT::Update::Post-Invoke-Success;' > "$apt_dir/local.conf"
  apt_options=(-c "$apt_dir/local.conf" -o "Dir::Etc::sourcelist=$apt_dir/sources.list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$apt_dir/lists" -o "Dir::Cache=$apt_dir/archives")
  apt-get "${apt_options[@]}" update
  (cd "$apt_dir/debs"; apt-get "${apt_options[@]}" download xvfb)
  for package in "$apt_dir"/debs/xvfb_*.deb; do dpkg-deb -x "$package" /workspace/.cache/desktop-runtime; done
fi
