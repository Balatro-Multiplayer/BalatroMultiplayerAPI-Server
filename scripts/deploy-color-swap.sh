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
$COMPOSE exec nginx nginx -s reload

log "draining in-flight requests against api-$ACTIVE (${DRAIN_PAUSE_S}s)..."
sleep "$DRAIN_PAUSE_S"

log "stopping api-$ACTIVE..."
$COMPOSE stop "api-$ACTIVE"

# web's API_SERVER_URL points at the stable "api" alias (the nginx
# container), which never changes identity across a swap -- nothing to
# restart there.

log "done. active color is now api-$INACTIVE."
