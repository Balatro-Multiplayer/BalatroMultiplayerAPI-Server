FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/internal/package.json ./packages/internal/
COPY packages/types/package.json ./packages/types/
COPY apps/server/package.json ./apps/server/

RUN pnpm install --frozen-lockfile --filter balatro-multiplayer-api-server...

COPY packages/ ./packages/
COPY apps/server/ ./apps/server/

RUN pnpm --filter @bmp/types build
RUN pnpm --filter @v-rtualized/bmp-internal build
RUN pnpm --filter balatro-multiplayer-api-server build

EXPOSE 8788

CMD ["sh", "-c", "pnpm --filter balatro-multiplayer-api-server migrate && pnpm --filter balatro-multiplayer-api-server start"]
