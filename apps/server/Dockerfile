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

# modzip: the deterministic mod-archive builder mods-sync.service.ts shells
# out to (see native/modzip/modzip.c) - links libzip so the hash it
# produces matches the launcher's own ZipWriter::zipDirectory() byte-for-
# byte. build-base (gcc/make) is only needed to compile it; removed
# afterward to keep the final image lean. libzip-dev is left installed
# since it's also how libzip's runtime shared library gets pulled in on
# Alpine - removing it risks taking the .so modzip needs at runtime with it.
RUN apk add --no-cache libzip-dev build-base \
	&& gcc -O2 -std=c11 -D_POSIX_C_SOURCE=200809L -Wall -Wextra \
		-o /usr/local/bin/modzip apps/server/native/modzip/modzip.c -lzip \
	&& apk del build-base

RUN pnpm --filter @bmp/types build
RUN pnpm --filter @v-rtualized/bmp-internal build
RUN pnpm --filter balatro-multiplayer-api-server build

EXPOSE 8788

CMD ["sh", "-c", "pnpm --filter balatro-multiplayer-api-server migrate && pnpm --filter balatro-multiplayer-api-server start"]
