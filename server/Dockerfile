# Schreibzeit API — Bun runtime image.
FROM oven/bun:1.4-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

# Copy the source.
COPY . .

# Default config (override at runtime). The DB lives on a mounted volume.
ENV PORT=3000
ENV DB_PATH=/data/schreibzeit.sqlite
EXPOSE 3000
VOLUME ["/data"]

CMD ["bun", "src/index.ts"]
