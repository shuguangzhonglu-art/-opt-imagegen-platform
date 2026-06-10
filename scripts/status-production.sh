#!/usr/bin/env bash
set -u

APP_ROOT="/opt/imagegen-platform"
CURRENT_LINK="$APP_ROOT/current"

printf '== current ==\n'
readlink -f "$CURRENT_LINK" 2>/dev/null || true
if [[ -f "$CURRENT_LINK/RELEASE_COMMIT" ]]; then
  printf 'commit: '
  cat "$CURRENT_LINK/RELEASE_COMMIT"
fi
if [[ -f "$CURRENT_LINK/.next/BUILD_ID" ]]; then
  printf 'build: '
  cat "$CURRENT_LINK/.next/BUILD_ID"
  printf '\n'
fi

printf '== services ==\n'
systemctl is-active imagegen-platform.service imagegen-worker.service

printf '== ports ==\n'
ss -ltnp | grep -E ':(4320) ' || true

printf '== health ==\n'
curl -sS -o /dev/null -w 'local:%{http_code} %{time_total}\n' http://127.0.0.1:4320/
curl -sS -L -o /dev/null -w 'public:%{http_code} %{time_total}\n' https://image.hemasir.online/

printf '== recent errors ==\n'
journalctl -u imagegen-platform.service -u imagegen-worker.service --since '10 minutes ago' --no-pager \
  | grep -Ei 'error|failed|MODULE_NOT_FOUND|SignatureDoesNotMatch|ECONN|timeout' \
  | tail -80 || true
