FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter balatro-multiplayer-web...

COPY apps/web/ ./apps/web/

RUN pnpm --filter balatro-multiplayer-web build

# ---- runtime ----
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/apps/web/.output ./.output

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
