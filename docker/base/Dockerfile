# glovebox/base — runtime base image for Glovebox apps.
#
# Provides Node 22, the standard filesystem layout (/work writable,
# /input read-only, /output writable), a non-root `glovebox` user, and
# pre-built native modules (better-sqlite3) so per-app images don't
# pay rebuild cost.
#
# Per-app images extend this with `FROM ghcr.io/porkytheblack/glovebox/base:1.1`.
#
# Node 22, not 20, and the reason is worth keeping: pdf.js (pdfjs-dist v5+,
# which `env:render` rasterizes through) calls
# `ArrayBuffer.prototype.transferToFixedLength`, added in Node 21. On Node 20
# it throws — and pdf.js swallows the throw per operator, logging
#
#     getOperatorList - ignoring errors during "GetOperatorList: page 0" task:
#     "TypeError: buffer.transferToFixedLength is not a function"
#
# then finishing the page anyway. Measured in-container on the 20 base: a
# rasterized Word document returned a path, 893x1263 dimensions and 7224
# bytes, the caller reported success, and the PNG was blank. A silent blank
# page is worse than a crash, and nothing above this line can detect it.
# Node 20 also left maintenance in April 2026.
FROM node:22-bookworm-slim

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
