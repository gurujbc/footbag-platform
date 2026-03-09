# =============================================================================
# Footbag Platform — Web Container
# Multi-stage build: compile TypeScript in builder, run lean image in runtime.
# =============================================================================

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
# Full dev deps needed to compile TypeScript and build better-sqlite3 native.
FROM node:18-alpine AS builder

WORKDIR /app

# Install build tools required by better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

# Copy manifests first so dependency layer is cached unless they change
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
# Lean image with only production dependencies.
FROM node:18-alpine AS runtime

WORKDIR /app

# Build tools needed to rebuild better-sqlite3 native addon for this image's
# musl libc target (prebuilt binaries target glibc and won't work on Alpine).
RUN apk add --no-cache python3 make g++

# Install production deps (triggers better-sqlite3 native rebuild for Alpine)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Copy non-compiled assets that tsc does not process.
# IMPORTANT: these must be explicitly copied — tsc only emits .js files.
# Views path: process.cwd()/src/views  → /app/src/views
# Static path: process.cwd()/src/public → /app/src/public
COPY src/views  ./src/views
COPY src/public ./src/public

# Runtime environment — all sensitive values must be injected at deploy time,
# not baked into the image.
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Healthcheck so compose and container runtimes can detect unresponsive containers
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["node", "dist/server.js"]
