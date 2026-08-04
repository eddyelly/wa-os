# syntax=docker/dockerfile:1

# Built from the REPOSITORY ROOT (the pnpm workspace), not from apps/api:
#   docker build -f apps/api/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer. Only the
# manifests are copied here; the lockfile install is what we want cached.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ports/package.json packages/ports/
RUN pnpm install --frozen-lockfile

# Inheriting from deps keeps node_modules in every workspace location pnpm
# put them, which is more reliable than copying those paths by hand.
FROM deps AS runtime
ENV NODE_ENV=production
COPY packages/ports packages/ports
COPY packages/shared packages/shared
COPY apps/api apps/api
# Generate the Prisma client at build time so boot does no codegen. The URL is
# only read at runtime; a placeholder satisfies the schema during generate.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm -F @waos/api exec prisma generate
EXPOSE 4000
CMD ["pnpm", "-F", "@waos/api", "start:prod"]
