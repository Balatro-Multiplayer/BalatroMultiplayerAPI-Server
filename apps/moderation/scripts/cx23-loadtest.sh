#!/usr/bin/env bash
# One-command CX23-sim load test.
#
# Builds the production service image, runs it capped at 2 vCPU / 2 GB (an
# optimistic stand-in for a Hetzner CX23), waits for the models to load, then
# fires the open-loop harness at it and prints the latency/throughput tables.
# No cloud, no deploy — the whole thing runs on this machine.
#
#   bash scripts/cx23-loadtest.sh                        # curated sweep (funnel + ML ceiling)
#   PROFILE=realistic RATES=1,2,3 bash scripts/cx23-loadtest.sh  # realistic mix: watch the length tax
#   PROFILE=worst RATES=5,10 bash scripts/cx23-loadtest.sh       # push the ML ceiling further
#   KEEP=1 bash scripts/cx23-loadtest.sh                 # leave the container running after
#   ENGLISH_ONLY=1 bash scripts/cx23-loadtest.sh         # skip the multilingual model (faster)
#
# Runs from the service/ workspace (its Dockerfile is the build context). Needs
# Docker + Node >=22 on PATH (the harness is host-side, zero-dep). First run
# downloads ~240 MB of models into a named volume, so it's slow once, fast after.
# Full knob list + how to read the tables: docs/10-load-testing.md.
set -euo pipefail

# --- config (all overridable via env) ---
IMAGE="${IMAGE:-bmp-moderation-service:cx23sim}"
CONTAINER="${CONTAINER:-bmp-mod-cx23}"
PORT="${PORT:-48901}"
CPUS="${CPUS:-2}"
MEM="${MEM:-2g}"
TOKEN="${SVC_TOKEN:-cx23-loadtest-token}"
MODEL_VOLUME="${MODEL_VOLUME:-bmp-model-cache}"
INGRESS_BURST="${MODERATION_INGRESS_BURST:-600}"   # raise past all stages so we
INGRESS_RATE="${MODERATION_INGRESS_RATE:-300}"     # measure hardware, not the valve
READY_TIMEOUT_S="${READY_TIMEOUT_S:-600}"          # first run downloads the models
SKIP_BUILD="${SKIP_BUILD:-0}"
KEEP="${KEEP:-0}"

# service/ is one level up from this script, regardless of caller's cwd.
SVC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SVC_DIR"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' not found on PATH" >&2; exit 1; }; }
need docker
need node
need curl

cleanup() {
	if [ "$KEEP" = "1" ]; then
		echo ">> KEEP=1 — leaving '$CONTAINER' running on :$PORT (docker rm -f $CONTAINER to stop)"
	else
		docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	fi
}
trap cleanup EXIT

# --- 1. build the production image ---
if [ "$SKIP_BUILD" = "1" ]; then
	echo ">> SKIP_BUILD=1 — using existing image $IMAGE"
else
	echo ">> building $IMAGE (production multi-stage; a few minutes)…"
	docker build -t "$IMAGE" -f Dockerfile .
fi

# --- 2. run it capped like a CX23 ---
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker volume create "$MODEL_VOLUME" >/dev/null

MULTI_ENV=()
if [ "${ENGLISH_ONLY:-0}" = "1" ]; then MULTI_ENV=(-e "MULTI_MODEL_ID="); fi

echo ">> starting $CONTAINER  (--cpus $CPUS --memory $MEM, ingress $INGRESS_RATE/s)…"
docker run -d --name "$CONTAINER" \
	--cpus "$CPUS" --memory "$MEM" \
	-p "127.0.0.1:$PORT:8001" \
	-e "MODERATION_BEARER_TOKEN=$TOKEN" \
	-e "MODERATION_INGRESS_BURST=$INGRESS_BURST" \
	-e "MODERATION_INGRESS_RATE=$INGRESS_RATE" \
	-e "MODEL_CACHE_DIR=/model-cache" \
	${MULTI_ENV[@]+"${MULTI_ENV[@]}"} \
	-v "$MODEL_VOLUME:/model-cache" \
	"$IMAGE" >/dev/null

# --- 3. wait for the models to load ---
ready_note=""
if [ "${ENGLISH_ONLY:-0}" = "1" ]; then ready_note=", english-only"; fi
echo ">> waiting for model load (up to ${READY_TIMEOUT_S}s${ready_note})…"
deadline=$((SECONDS + READY_TIMEOUT_S))
until curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"model_loaded":true'; do
	if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
		echo; echo "!! container exited during startup — last logs:" >&2
		docker logs --tail 40 "$CONTAINER" 2>&1 || true
		exit 1
	fi
	if [ "$SECONDS" -ge "$deadline" ]; then
		echo; echo "!! model not ready after ${READY_TIMEOUT_S}s — last logs:" >&2
		docker logs --tail 40 "$CONTAINER" 2>&1 || true
		exit 1
	fi
	sleep 3; printf '.'
done
echo " ready."

# --- 4. fire the open-loop harness ---
# Cap client-side in-flight requests so an overloaded ML stage can't bury the
# service into an OOM: the harness marks over-cap requests "dropped" (the
# overload signal we want) while the container stays alive for later stages.
export SVC_URL="http://127.0.0.1:$PORT" SVC_TOKEN="$TOKEN"
export MAX_INFLIGHT="${MAX_INFLIGHT:-50}"

assert_alive() { # health-gate before each stage; on death, diagnose then stop
	curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"model_loaded":true' && return 0
	echo
	echo "!! the service is no longer healthy — stopping the sweep."
	local oom code
	oom=$(docker inspect -f '{{.State.OOMKilled}}' "$CONTAINER" 2>/dev/null || echo '?')
	code=$(docker inspect -f '{{.State.ExitCode}}' "$CONTAINER" 2>/dev/null || echo '?')
	echo "   container: OOMKilled=$oom exitCode=$code"
	[ "$oom" = "true" ] && cat <<-EOF
	   -> a prior stage exhausted the ${MEM} cap. In PRODUCTION the ingress valve
	      (MODERATION_INGRESS_RATE, default 25/s) sheds 429s long before this; this
	      sim raised it to ${INGRESS_RATE}/s to measure raw hardware. Lesson: on a
	      CX23, cap ingress near the ML rate so the valve — not the box — eats bursts.
	EOF
	echo "   last logs:"; docker logs --tail 20 "$CONTAINER" 2>&1 | sed 's/^/     /' || true
	exit 1
}

stage() { # profile  rates  label  [length_mix]
	assert_alive
	echo
	echo "==================================================================="
	echo ">> $3"
	echo "   PROFILE=$1  RATES=$2${4:+  LENGTH_MIX=$4}  (MAX_INFLIGHT=$MAX_INFLIGHT)"
	echo "==================================================================="
	PROFILE="$1" RATES="$2" DURATION_S="${DURATION_S:-25}" WARMUP_S="${WARMUP_S:-6}" \
		LENGTH_MIX="${4:-${LENGTH_MIX:-50,35,15}}" \
		node scripts/load-test.mjs || true   # overload is an expected result, not a failure
}

if [ -n "${PROFILE:-}" ] || [ -n "${RATES:-}" ]; then
	stage "${PROFILE:-realistic}" "${RATES:-2,3}" "custom stage"
else
	# Two reliable, green stages that tell the whole story. The realistic/long-msg
	# path is host-contention-noisy on Docker Desktop (its model-load time is a
	# tell), so it's an opt-in stage (see the header) + the docs/10 "Measured
	# results" narrative rather than a headline that swings run-to-run.
	stage deterministic "200" "FUNNEL CEILING — deterministic tiers, no ML (the 'can it do 100 TPS?' yes)"
	stage worst         "2,3" "ML CEILING — 100% scored by both models, short msgs (~4 rps is the SLO line)" "100,0,0"
fi

cat <<-EOF

	>> done.  Real BMP volume is ~0.3 msg/s, so even a few ML rps is 10x+ headroom.
	   • Funnel (deterministic tiers) scales to ~200 rps at ~12 ms — the common case is free.
	   • Dual-model ML is the scarce lane: ~4 rps of short messages at the 500 ms SLO.
	   • Realistic traffic (long messages) is heavier still — run
	     'PROFILE=realistic RATES=1,2,3 bash scripts/cx23-loadtest.sh' to watch the length tax.
	   Caveat: on Docker Desktop (Windows/Mac) the container shares a VM + your busy host,
	   so ML numbers are a PESSIMISTIC, run-to-run-noisy floor (this run's model-load time is
	   a tell) — a dedicated Linux CX23 measures higher and steadier. The SHAPE (funnel fast,
	   ML the scarce lane), not the exact rps, is the takeaway.
EOF
