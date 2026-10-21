# syntax = docker/dockerfile:1

ARG BUN_VERSION=1
FROM oven/bun:${BUN_VERSION}-slim AS base

LABEL fly_launch_runtime="Bun"

WORKDIR /app
ENV NODE_ENV="production"

# --- Build stage ---
FROM base AS build

# Install build tools (for any native modules; removed from final image)
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

# Backend dependencies (cached until root package.json/bun.lock change)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Frontend dependencies (cached until frontend/package.json or frontend/bun.lock change)
COPY frontend/package.json frontend/bun.lock ./frontend/
WORKDIR /app/frontend
RUN bun install --frozen-lockfile

# Frontend source + build (cached until frontend source changes)
COPY frontend/ ./
RUN bun run build

# Backend source (changes only on backend edits; cached otherwise)
WORKDIR /app
COPY . .

# Remove frontend source (build output is already in /app/dist)
RUN rm -rf /app/frontend

# --- Production stage ---
FROM base

# Install curl for healthcheck
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Create data directory for SQLite (overlayed by volume mounts at runtime)
RUN mkdir -p /data

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/status || exit 1

EXPOSE 3000
CMD ["bun", "index.ts"]
