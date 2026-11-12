# Multi-stage build for the Logistics backend.
# Build context must be the `logistics/` workspace root:
#   docker build -f apps/backend/Dockerfile -t bigant-backend .

# ---- Base ----
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# Prisma needs openssl at runtime and build time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/
RUN pnpm install --frozen-lockfile

# ---- Build ----
# Layered by what changes least: the shared package, then the Prisma schema,
# then the backend source. A change to the backend alone reuses the first
# two; a change to the web app reuses everything, and this image is not
# rebuilt at all.
FROM deps AS build
COPY packages/shared ./packages/shared
RUN pnpm --filter @bigant/shared build
COPY apps/backend/prisma ./apps/backend/prisma
RUN pnpm --filter @bigant/backend exec prisma generate
COPY apps/backend ./apps/backend
RUN pnpm --filter @bigant/backend build

# ---- Runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/backend
EXPOSE 3000
# Run pending migrations, then start the API.
# exec: node replaces the shell as PID 1, so a deploy's SIGTERM reaches it —
# requests in hand finish and the worker lease is let go at once, instead of
# the shell ignoring the signal and the container being killed 30s later.
CMD ["sh", "-c", "pnpm prisma migrate deploy && exec node dist/main.js"]
