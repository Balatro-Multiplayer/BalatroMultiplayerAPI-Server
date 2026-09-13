#!/usr/bin/env bash
# Blue-green swap for bmp-api: builds+migrates+health-checks the inactive
# color, cuts the dockerized `nginx` reverse proxy over to it (a single
# small file rewrite + `nginx -s reload`, which drains in-flight requests
# without dropping any), then stops the old color. Active color is read
# from nginx/upstream.conf itself -- no separate marker file to drift out
# of sync with reality.
#
# Same script, same behavior, in both environments now that nginx itself is
# part of docker-compose.yml rather than a separately hand-maintained host
# install on bmpserver -- the only difference between local and prod is
# which compose files this picks up, not the swap logic itself.
#
# Usage (from repo root):
#   ./scripts/deploy-color-swap.sh                        # local dev (default: base + local overlay)
#   BASE_ONLY=1 ./scripts/deploy-color-swap.sh             # prod: base file only, no local overlay
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${BASE_ONLY:-}" ]; then
	COMPOSE="docker compose -f docker-compose.yml"
else
	COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml"
fi
UPSTREAM_CONF="nginx/upstream.conf"
HEALTH_TIMEOUT_S=60
DRAIN_PAUSE_S=2
CUTOVER_VERIFY_TIMEOUT_S=15

log() { echo "[deploy] $*"; }

current_color() {
	if grep -q "server api-green:8788;" "$UPSTREAM_CONF"; then
		echo "green"
	else
		echo "blue"
	fi
}

ACTIVE=$(current_color)
if [ "$ACTIVE" = "blue" ]; then
	INACTIVE="green"
else
	INACTIVE="blue"
fi

log "active=api-$ACTIVE inactive=api-$INACTIVE"

log "building images..."
$COMPOSE build "api-$INACTIVE"

log "running migrations once (idempotent)..."
$COMPOSE run --rm "api-$INACTIVE" sh -c "pnpm --filter balatro-multiplayer-api-server migrate"

log "starting api-$INACTIVE..."
$COMPOSE up -d --no-deps "api-$INACTIVE"

log "waiting for api-$INACTIVE to report healthy (up to ${HEALTH_TIMEOUT_S}s)..."
elapsed=0
while true; do
	status=$(docker inspect --format='{{.State.Health.Status}}' "bmp-api-$INACTIVE" 2>/dev/null || echo "starting")
	if [ "$status" = "healthy" ]; then
		log "api-$INACTIVE is healthy"
		break
	fi
	if [ "$elapsed" -ge "$HEALTH_TIMEOUT_S" ]; then
		echo "[deploy] ERROR: api-$INACTIVE did not become healthy within ${HEALTH_TIMEOUT_S}s (status=$status)" >&2
		exit 1
	fi
	sleep 2
	elapsed=$((elapsed + 2))
done

log "cutting nginx over to api-$INACTIVE..."
cat > "$UPSTREAM_CONF" <<EOF
# Rewritten by scripts/deploy-color-swap.sh on every cutover -- the ONLY
# thing that changes during a swap. Bind-mounted from the host so the swap
# script can edit it directly and \`nginx -s reload\` picks it up without
# rebuilding or restarting this container.
upstream bmp_api_active {
	server api-$INACTIVE:8788;
}
EOF

# Docker bind-mounts a single file by inode, not by path: if this file was
# EVER rewritten on the host via a rename-based tool (sed -i, mv, an editor's
# atomic save -- anything that doesn't open(O_TRUNC) the existing inode in
# place), the container's mount silently detaches from the host path and
# keeps serving whatever it last saw, forever, with no error from anything.
# `cat >` above is safe (it truncates in place), but nothing stops a human
# from editing this file some other way later -- so verify the container
# actually sees this exact rewrite before trusting nginx -s reload to have
# done anything at all.
if ! $COMPOSE exec -T nginx cat /etc/nginx/conf.d/upstream.conf | grep -q "server api-$INACTIVE:8788;"; then
	echo "[deploy] ERROR: nginx container's /etc/nginx/conf.d/upstream.conf still doesn't mention api-$INACTIVE after rewriting $UPSTREAM_CONF on the host." >&2
	echo "[deploy] The bind mount is stale (likely broken by a prior rename-based edit of this file) -- api-$ACTIVE was NOT stopped." >&2
	echo "[deploy] Fix: docker compose -f docker-compose.yml up -d --no-deps --force-recreate nginx, then re-run this script." >&2
	exit 1
fi

$COMPOSE exec nginx nginx -s reload

# Confirms the reload actually took effect end-to-end (config propagated +
# reload applied + api-$INACTIVE reachable on the docker network), the same
# request nginx's own healthcheck makes -- not just that the file matched
# above. This is what would have caught today's incident: the file check
# alone can still pass while nginx is serving from a config an old worker
# cached before a *previous* broken reload, or api-$INACTIVE is up but
# unreachable for some other reason.
log "verifying api-$INACTIVE is actually reachable through nginx (up to ${CUTOVER_VERIFY_TIMEOUT_S}s)..."
elapsed=0
while true; do
	if $COMPOSE exec -T nginx wget -q --spider "http://127.0.0.1:8788/health"; then
		log "cutover verified -- nginx is serving api-$INACTIVE"
		break
	fi
	if [ "$elapsed" -ge "$CUTOVER_VERIFY_TIMEOUT_S" ]; then
		echo "[deploy] ERROR: nginx is not serving a working upstream ${CUTOVER_VERIFY_TIMEOUT_S}s after cutover -- api-$ACTIVE was NOT stopped." >&2
		echo "[deploy] Investigate before retrying (check: docker logs bmp-nginx, docker compose exec nginx cat /etc/nginx/conf.d/upstream.conf)." >&2
		exit 1
	fi
	sleep 2
	elapsed=$((elapsed + 2))
done

log "draining in-flight requests against api-$ACTIVE (${DRAIN_PAUSE_S}s)..."
sleep "$DRAIN_PAUSE_S"

log "stopping api-$ACTIVE..."
$COMPOSE stop "api-$ACTIVE"

# web's API_SERVER_URL points at the stable "api" alias (the nginx
# container), which never changes identity across a swap -- nothing to
# restart there.

log "done. active color is now api-$INACTIVE."
