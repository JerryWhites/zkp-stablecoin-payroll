# ====================================
# CZKP Payroll Backend — Production Dockerfile
# ====================================
# Multi-stage build for minimal attack surface
# Runs as non-root user for security

# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Production image
FROM node:20-alpine AS production

# Security: add non-root user
RUN addgroup -g 1001 -S payroll && \
    adduser -S payroll -u 1001 -G payroll

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY server-secure.js ./
COPY db.js ./
COPY security-hardening.js ./
COPY security-monitor.js ./
COPY session-manager.js ./
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY services/ ./services/
COPY migrations/ ./migrations/
COPY fonts/ ./fonts/

# Create required directories with correct ownership
RUN mkdir -p logs uploads uploads/quarantine exports backups && \
    chown -R payroll:payroll /app

# Switch to non-root user
USER payroll

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

EXPOSE 5000

# Use node directly (not npm) for proper signal handling
CMD ["node", "server-secure.js"]
