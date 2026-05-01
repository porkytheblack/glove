# glovebox/base — runtime base image for Glovebox apps.
#
# Provides Node 20, the standard filesystem layout (/work writable,
# /input read-only, /output writable), a non-root `glovebox` user, and
# pre-built native modules (better-sqlite3) so per-app images don't
# pay rebuild cost.
#
# Per-app images extend this with `FROM ghcr.io/porkytheblack/glovebox/base:1.0`.
FROM node:20-bookworm-slim

# Locale + tini for proper signal handling.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl tini dumb-init \
 && rm -rf /var/lib/apt/lists/*

# Standard glovebox user + filesystem layout.
# /input is owned by root and chmod 555 so the agent can read but not modify it.
RUN useradd -m -u 10001 -s /bin/bash glovebox \
 && mkdir -p /work /input /output /var/glovebox/files \
 && chown glovebox:glovebox /work /output /var/glovebox /var/glovebox/files \
 && chown root:root /input && chmod 555 /input

# Pre-install native modules used by glovebox-kit so per-app images can skip
# the build step. The actual app bundle lives in /opt/glovebox-server and
# symlinks back to this directory at deploy time.
RUN mkdir -p /opt/glovebox-prebuilt \
 && cd /opt/glovebox-prebuilt \
 && npm init -y > /dev/null \
 && npm install --omit=dev --no-audit --no-fund better-sqlite3@^11.5.0 \
 && chown -R glovebox:glovebox /opt/glovebox-prebuilt

ENV GLOVEBOX_PORT=8080 \
    NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps"

USER glovebox
WORKDIR /opt/glovebox-server
EXPOSE 8080

# Per-app images override CMD; this is the fallback for `docker run base`.
ENTRYPOINT ["tini", "--"]
CMD ["node", "/opt/glovebox-server/index.js"]
