# BIGANT — Logistics System

Internal Logistics Automation System for BIGANT. A **modular monolith** built with a
TypeScript-everywhere stack inside a pnpm + Turborepo monorepo.

> Architecture, data model, and the full phased roadmap live in
> [`../PROJECT_PLAN.md`](../PROJECT_PLAN.md).

## Layout

```
logistics/
  apps/
    backend/    NestJS API (auth, domain modules, background worker)
    web/        React dashboard — Admin + Seller        (Phase 2)
    mobile/     React Native (Expo) — Driver            (Phase 3)
  packages/
    shared/     zod schemas, types, enums, permission matrix (used by all apps)
```

## Prerequisites

- Node.js 20+ (`nvm use`)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`)
- Docker + Docker Compose (for local Postgres & Redis)

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres + Redis
docker compose up -d postgres redis

# 3. Configure environment
cp apps/backend/.env.example apps/backend/.env   # then edit secrets

# 4. Apply schema + seed the first admin
pnpm --filter @bigant/backend db:migrate
pnpm --filter @bigant/backend db:seed

# 5. Run the backend in watch mode
pnpm --filter @bigant/backend dev
```

API docs (Swagger): http://localhost:3000/docs · Health: http://localhost:3000/health

## Workspace scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build every package (Turborepo, dependency-ordered) |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run all tests |
| `pnpm lint` | ESLint across the repo |
| `pnpm format` | Prettier write |

## Status

**Phase 0 — Foundations.** Monorepo, shared package, NestJS skeleton, Prisma + first
migration, auth + seeded admin, Docker, and CI. See `PROJECT_PLAN.md` §5 for what comes next.

## Xavfsizlik / Security

Bu ommaviy nusxa. Ichida real ma'lumotlar bazasi, parollar, kalitlar va xodimlar
ma'lumotlari **yo'q**: server manzili `example.com`, ismlar, telefonlar, Telegram
ID'lar va mashina raqamlari soxta, mahsulotlar ro'yxati namunaviy. Barcha
sozlamalar `.env.example` fayllaridan nusxa olib to'ldiriladi.

This is a public copy: no real database, passwords, keys or staff data. Hosts,
names, phone numbers, Telegram ids and plates are fake; the product list is a
sample. Copy the `.env.example` files and fill in your own values.

© Doston Bunyodov. All rights reserved.
