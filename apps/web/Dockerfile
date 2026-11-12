# Builds the dashboard into static files and bakes them into an nginx image.
# Build context must be the `logistics/` workspace root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=/api -t bigant-web .
#
# VITE_API_URL is compiled into the bundle at build time — it cannot be changed
# by an environment variable at runtime. `/api` keeps the API same-origin, which
# is why the browser needs no CORS grant and the SSE token never crosses hosts.

# ---- Build ----
FROM node:20-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# The shared package first, built on its own: a change to the web app alone
# reuses it, and only the Vite build runs.
COPY packages/shared ./packages/shared
RUN pnpm --filter @bigant/shared build
COPY apps/web ./apps/web

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @bigant/web build

# ---- Runtime ----
FROM nginx:1.27-alpine AS runtime
# Only DOMAIN is substituted; without this filter envsubst would also eat
# nginx's own runtime variables ($host, $uri, ...) and break the config.
ENV NGINX_ENVSUBST_FILTER=DOMAIN
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# Rendered to /etc/nginx/conf.d/default.conf on container start.
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80 443
