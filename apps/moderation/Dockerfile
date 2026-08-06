# Moderation service (verdict API). Node + in-process Qwen3Guard via
# node-llama-cpp — the guard is the only model and it judges inside /moderate.
#
# debian-slim, NOT alpine (unlike apps/server): node-llama-cpp's prebuilt
# llama.cpp binaries declare libc "glibc", and musl is unsupported. Pinned to
# trixie rather than the bare `24-slim` alias because that alias still means
# bookworm and would silently flip the base OS and glibc under the native
# binaries when docker-node changes its default.
#
# Built from the REPO ROOT, like apps/server:
#   docker build -f apps/moderation/Dockerfile .
FROM node:24-trixie-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/moderation/package.json ./apps/moderation/

RUN pnpm install --frozen-lockfile --filter balatro-multiplayer-moderation...

COPY apps/moderation/ ./apps/moderation/

RUN pnpm --filter balatro-multiplayer-moderation build

ENV NODE_ENV=production
# Surfaced at GET /health so you can tell which commit is actually running.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# The model is deliberately NOT baked into the image — mount a volume at
# /model-cache and put the GGUF there. This is a DIRECTORY on purpose: the
# service loads the single .gguf it finds, so the filename does not have to
# match anything. Point GUARD_MODEL at a specific file if you keep several.
ENV GUARD_MODEL=/model-cache

EXPOSE 8001

# Generous start period: loading the GGUF on CPU takes a few seconds and the
# first judgement warms the compute graph.
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=180s \
	CMD node -e "fetch('http://localhost:8001/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/moderation
CMD ["node", "dist/main.js"]
