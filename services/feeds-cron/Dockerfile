# Minimal image for the scheduled data-feed ingest scripts (Railway cron services).
#
# The ingest scripts use ONLY Node built-ins (fetch/fs/url/path) plus their local
# helpers in scripts/lib — no npm dependencies, no build step, no data files (the
# suburb list is hardcoded). So this image just needs Node 20 + the scripts dir.
#
# Build context is the repo root; Railway uses dockerfilePath=services/feeds-cron/Dockerfile
# with the service Root Directory left at the repo root. Each Railway cron service sets
# its own startCommand (which script + category) and cronSchedule via its config file
# (railway.feeds-*.json) and supplies creds + HEALTHCHECK_UUID via service env vars.
FROM node:20-slim

WORKDIR /app

# Only the scripts are needed. .env.local is intentionally absent — the loader is
# wrapped in try/catch and falls back to process.env (provided by Railway).
COPY scripts ./scripts

# Default command is a no-op; each Railway service overrides startCommand. Keeping a
# harmless default avoids an image that exits with an error when run without one.
CMD ["node", "-e", "console.log('feeds-cron image — set a startCommand on the Railway service')"]
