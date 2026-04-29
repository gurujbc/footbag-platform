# =============================================================================
# Footbag Platform — Image Worker Container
# Standalone Express server wrapping the Sharp pipeline behind an HTTP boundary.
# Same multi-stage pattern as web/worker; runtime stage runs imageWorker.js.
# =============================================================================

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Sharp 0.34+ ships musl prebuilts but the existing pattern always rebuilds
# native deps via apk; matched here for parity with web/worker.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV IMAGE_PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "dist/imageWorker.js"]
