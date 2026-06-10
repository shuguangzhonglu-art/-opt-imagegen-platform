#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/imagegen-platform"
REPO_DIR="$APP_ROOT/repo"
RELEASES_DIR="$APP_ROOT/releases"
SHARED_DIR="$APP_ROOT/shared"
CURRENT_LINK="$APP_ROOT/current"
WEB_SERVICE="imagegen-platform.service"
WORKER_SERVICE="imagegen-worker.service"
BRANCH="${1:-main}"

log() {
  printf '[image deploy] %s\n' "$*"
}

fail() {
  printf '[image deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

healthcheck() {
  systemctl is-active --quiet "$WEB_SERVICE"
  systemctl is-active --quiet "$WORKER_SERVICE"
  curl -fsS --max-time 10 http://127.0.0.1:4320/ >/dev/null
}

wait_for_healthcheck() {
  local attempts="${1:-30}"
  local delay="${2:-1}"
  local i

  for ((i = 1; i <= attempts; i += 1)); do
    if healthcheck; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

[[ "$APP_ROOT" == "/opt/imagegen-platform" ]] || fail "refuse to deploy outside /opt/imagegen-platform"
[[ "$WEB_SERVICE" == "imagegen-platform.service" ]] || fail "unexpected web service"
[[ "$WORKER_SERVICE" == "imagegen-worker.service" ]] || fail "unexpected worker service"

previous_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

mkdir -p "$RELEASES_DIR" "$SHARED_DIR/generated"
[[ -d "$REPO_DIR/.git" ]] || fail "$REPO_DIR is not a git repository"

cd "$REPO_DIR"
log "fetch origin"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

commit="$(git rev-parse --short=12 HEAD)"
stamp="$(date -u +%Y%m%d%H%M%S)"
release="$RELEASES_DIR/${stamp}-${commit}"

log "install dependencies"
npm ci

log "generate prisma client"
npx prisma generate

log "build standalone"
npm run build
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -R .next/static .next/standalone/.next/static

log "create release $release"
mkdir -p "$release"
rsync -a --delete \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules' \
  --exclude='.next/cache' \
  --exclude='coverage' \
  --exclude='public/generated' \
  --exclude='prisma/*.db' \
  --exclude='prisma/*.db-*' \
  "$REPO_DIR/" "$release/"

ln -sfn "$REPO_DIR/node_modules" "$release/node_modules"
ln -sfn "$SHARED_DIR/.env" "$release/.env"
mkdir -p "$release/public"
rm -rf "$release/public/generated"
ln -sfn "$SHARED_DIR/generated" "$release/public/generated"

printf '%s\n' "$commit" > "$release/RELEASE_COMMIT"
printf '%s\n' "$BRANCH" > "$release/RELEASE_BRANCH"

log "activate release"
ln -sfn "$release" "$CURRENT_LINK"
sudo systemctl restart "$WEB_SERVICE" "$WORKER_SERVICE"

if wait_for_healthcheck 30 1; then
  log "ok: $release"
  exit 0
fi

log "healthcheck failed, rolling back"
if [[ -n "$previous_release" && -d "$previous_release" ]]; then
  ln -sfn "$previous_release" "$CURRENT_LINK"
  sudo systemctl restart "$WEB_SERVICE" "$WORKER_SERVICE"
  wait_for_healthcheck 30 1 || fail "rollback healthcheck failed; inspect services manually"
  fail "deploy failed and rolled back to $previous_release"
fi

fail "deploy failed and no previous release exists"
