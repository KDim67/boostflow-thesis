# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including dev deps needed for build)
# Also explicitly install the musl-specific Tailwind CSS oxide binary
# since npm ci on Alpine doesn't always resolve the correct platform variant
RUN npm ci && npm install @tailwindcss/oxide-linux-x64-musl lightningcss-linux-x64-musl

# Copy source code
COPY . .

# Build the Next.js application
ENV NODE_ENV=production
# Mount the secret file provided by Jenkins at /run/secrets/build_env
RUN --mount=type=secret,id=build_env \
    # 1. Copy secret to .env.production so Next.js can read it
    cp /run/secrets/build_env .env.production && \
    # 2. Run the build
    npm run build && \
    # 3. Remove the env file from source
    rm -f .env.production && \
    # 4. Remove any .env files that may have been copied to standalone output
    find .next/standalone -name ".env*" -type f -delete 2>/dev/null || true && \
    find .next/standalone -name "*.env" -type f -delete 2>/dev/null || true

# Stage 2: Production image with distroless
FROM gcr.io/distroless/nodejs20-debian12@sha256:3db2ff68a5e0a09955ee9199d6de23a11e65e7a032d75a2f29ca44b36cb46ea8

# Set working directory
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy necessary files from builder stage with nonroot ownership
COPY --from=builder --chown=65532:65532 /app/public ./public
COPY --from=builder --chown=65532:65532 /app/.next/standalone ./
COPY --from=builder --chown=65532:65532 /app/.next/static ./.next/static

# Copy package metadata for SBOM scanning (not used at runtime)
COPY --from=builder --chown=65532:65532 /app/package.json ./package.json
COPY --from=builder --chown=65532:65532 /app/package-lock.json ./package-lock.json

# Use non-root user for security
USER 65532

# Healthcheck using Node.js since distroless has no shell
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

# Expose port for Next.js
EXPOSE 3000

# Start Next.js application
CMD ["server.js"]
