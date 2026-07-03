ARG APP=api

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY libs/config/package.json libs/config/
COPY libs/core/package.json libs/core/
COPY libs/llm/package.json libs/llm/
COPY libs/rag/package.json libs/rag/
COPY libs/database/package.json libs/database/
COPY libs/observability/package.json libs/observability/

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
ARG APP
COPY . .
ENV CI=true
RUN pnpm install --frozen-lockfile && pnpm exec nest build ${APP}

# ── prod-deps ─────────────────────────────────────────────────────────────────
# Production-only node_modules: the runtime image must not ship the dev tree
# (vitest, testcontainers, webpack, eslint, …) — size and CVE surface.
FROM base AS prod-deps
ENV CI=true
RUN pnpm install --frozen-lockfile --prod

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
ARG APP
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json .
# Migrations/migrate script are api-specific but harmless to ship in the
# worker image too — keeping them unconditional avoids ARG-gated COPY.
COPY --chown=nestjs:nodejs docker/migrations ./docker/migrations
COPY --chown=nestjs:nodejs scripts/migrate.js ./scripts/migrate.js

USER nestjs
EXPOSE 8080
ENV APP_MAIN=dist/apps/${APP}/main.js
CMD ["sh", "-c", "node ${APP_MAIN}"]
