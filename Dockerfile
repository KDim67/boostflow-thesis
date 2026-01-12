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
RUN npm ci

# Copy source code
COPY . .

# Build the Next.js application
ENV NODE_ENV=production
RUN npm run build

# Stage 2: Production image with distroless
FROM gcr.io/distroless/nodejs20-debian12

# Set working directory
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy necessary files from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy environment file
COPY --from=builder /app/.env.local ./.env.local

# Expose port for Next.js
EXPOSE 3000

# Start Next.js application
CMD ["server.js"]
