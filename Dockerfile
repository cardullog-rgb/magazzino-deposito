# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build deps for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Runtime deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3

# Copy built app
COPY --from=builder /app/dist ./dist

# Data directory (mapped to Railway volume at /data)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8080
# DB_PATH is set as Railway env variable → /data/data.db
ENV DB_PATH=/data/data.db

EXPOSE 8080

CMD ["node", "dist/index.cjs"]
