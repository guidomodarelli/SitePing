# Base images are pinned by digest, not just by tag: a tag is mutable, so
# `1.3.11-alpine` can be repointed at a different image than the one this
# Dockerfile was reviewed against. Dependabot's docker ecosystem bumps the
# digests (see .github/dependabot.yml), so pinning does not freeze them.
FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b AS builder
RUN apk add --no-cache nodejs
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

# Build workspace packages then demo
RUN bun run --filter='@beezping/core' build && \
    bun run --filter='@beezping/widget' build && \
    bun run --filter='@beezping/dashboard' build && \
    bun run --filter='@beezping/adapter-memory' build && \
    bun run --filter='@beezping/adapter-localstorage' build && \
    bun run --filter='@beezping/server' build
# Public origin of the deployed demo (e.g. `https://demo.example.com`). It is
# baked into the statically generated Open Graph metadata, canonical and
# hreflang links, robots.txt and the sitemap, so it is required at build time:
#   docker build --build-arg BEEZPING_SITE_URL=https://demo.example.com ...
ARG BEEZPING_SITE_URL
RUN : "${BEEZPING_SITE_URL:?apps/demo/Dockerfile: set --build-arg BEEZPING_SITE_URL to the public origin of the deployed demo (e.g. https://demo.example.com); without it metadata, robots.txt and the sitemap point at http://localhost:3000}" && \
    cd apps/demo && bun run build

# --- Runner ---
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/demo/.next/standalone ./
COPY --from=builder /app/apps/demo/.next/static ./apps/demo/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/demo/server.js"]
