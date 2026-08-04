# syntax=docker/dockerfile:1

# Built from the REPOSITORY ROOT (the pnpm workspace), not from apps/web:
#   docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ports/package.json packages/ports/
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
ENV NODE_ENV=production
# NEXT_PUBLIC_* values are baked into the client bundle by `next build`. They
# must be present HERE, at build time: setting them only at runtime ships a
# dashboard that calls http://localhost:4000.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_NAME=WaOS
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
# apps/web/tsconfig.json extends the shared root config; next build's
# type-checking step reads it, so it must be present in the image.
COPY tsconfig.base.json ./
COPY packages/ports packages/ports
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm -F @waos/web build
EXPOSE 3000
CMD ["pnpm", "-F", "@waos/web", "start"]
