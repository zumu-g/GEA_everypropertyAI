# Stealth scraper service — runs Camoufox (Firefox) / Patchright (Chromium) /
# Playwright-stealth (Chromium) under Playwright. Cannot run on Vercel; deploy as
# a long-running container (Fly.io, Railway, Fargate). The Playwright base image
# ships the OS-level browser dependencies, the matching Chromium build, and an
# adequate /dev/shm.
# Base image MUST match the Playwright version in package-lock.json (currently
# 1.60.0) — the bundled Chromium build the `playwright`/`patchright` engines load
# from /ms-playwright is version-specific. A mismatch fails with "Executable
# doesn't exist".
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# camoufox-js installs its Firefox to $HOME/.cache/camoufox; pin HOME so the
# build-time fetch and the runtime process resolve the same path.
ENV HOME=/root

# The base image already bundles the Chromium build matching this Playwright
# version (used by both the `playwright` and `patchright` engines), so skip the
# redundant per-package browser download during install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Download the custom Camoufox Firefox binary at build time, and fail the build
# loudly if it didn't land where the runtime expects it.
RUN npx camoufox-js fetch && test -f "$HOME/.cache/camoufox/version.json"

# Build the TypeScript service.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
