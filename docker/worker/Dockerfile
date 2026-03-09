# =============================================================================
# Footbag Platform — Worker Container
# MVFP v0.1: stub only — no jobs configured yet.
# Same build pattern as web so images stay consistent.
# =============================================================================

FROM node:18-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:18-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/worker.js"]
