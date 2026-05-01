# glovebox/browser — base + headless Chromium for screenshots, PDF render,
# and scraping.
#
# Surfaces @scraper and @screenshotter mentions. Uses Playwright's bundled
# Chromium so dependency drift is bounded.
FROM ghcr.io/dterminal/glovebox/base:1.0

USER root

# Chromium runtime deps. Playwright will install the binary itself; we just
# need the shared libraries.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libpango-1.0-0 \
      libcairo2 \
      libasound2 \
      libatspi2.0-0 \
      fonts-liberation \
      fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# Install Playwright + its bundled Chromium into a known location so the app
# can `require("playwright")` without a per-app install step.
RUN mkdir -p /opt/glovebox-prebuilt \
 && cd /opt/glovebox-prebuilt \
 && npm install --omit=dev --no-audit --no-fund playwright@^1.47.0 \
 && PLAYWRIGHT_BROWSERS_PATH=/opt/glovebox-prebuilt/.playwright \
      ./node_modules/.bin/playwright install chromium \
 && chown -R glovebox:glovebox /opt/glovebox-prebuilt

ENV GLOVEBOX_BASE_IMAGE=glovebox/browser \
    GLOVEBOX_BASE_VERSION=1.1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/glovebox-prebuilt/.playwright \
    NODE_PATH=/opt/glovebox-prebuilt/node_modules

USER glovebox
