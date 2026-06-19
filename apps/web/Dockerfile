FROM --platform=linux/amd64 imbios/bun-node:latest-current-debian AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile;

##### BUILDER

FROM --platform=linux/amd64 imbios/bun-node:latest-current-debian AS builder
ARG DATABASE_URL
ARG NEXT_PUBLIC_CLIENTVAR
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED 1
ENV SKIP_ENV_VALIDATION 1
RUN SKIP_ENV_VALIDATION=1 bun run build

##### RUNNER

FROM --platform=linux/amd64 imbios/bun-node:latest-current-debian AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT 3000

CMD ["node", "--expose-gc", "server.js"]
