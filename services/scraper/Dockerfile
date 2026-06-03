# Stealth scraper service — runs Camoufox (Firefox) / Patchright (Chromium) /
# Playwright-stealth (Chromium) under Playwright. Cannot run on Vercel; deploy as
# a long-running container (Fly.io, Railway, Fargate). The Playwright base image
# ships the OS-level browser dependencies, the matching Chromium build, and an
# adequate /dev/shm.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# The base image already bundles the Chromium build matching this Playwright
# version (used by both the `playwright` and `patchright` engines), so skip the
# redundant per-package browser download during install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Download the custom Camoufox Firefox binary at build time.
RUN npx camoufox-js fetch

# Build the TypeScript service.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
