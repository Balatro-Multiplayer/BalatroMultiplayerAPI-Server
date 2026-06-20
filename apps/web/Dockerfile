FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

##### DEPS — install with the full workspace manifest set so pnpm can resolve
##### the lockfile, but only for the web app's dependency closure.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/types/package.json ./packages/types/
COPY packages/internal/package.json ./packages/internal/

RUN pnpm install --frozen-lockfile --filter balatro-multiplayer-web...

COPY apps/web/ ./apps/web/

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter balatro-multiplayer-web build

##### RUNNER — run `next start` from the built app.
FROM build AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
