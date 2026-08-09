# glovebox/studio — the one image where the working environment's visual
# adapters all work at once.
#
# `env:render` rasterizes decks and Word files through headless LibreOffice.
# `env:motion` renders React scenes through headless Chromium. Until this
# image existed there was no base that had both: `glovebox/docs` has
# LibreOffice and no browser, `glovebox/browser` has a browser and no
# LibreOffice, and an agent that can make a deck but not look at it — or look
# at a scene but not at a document — is half an agent.
#
# Built on `docs` rather than `browser` because LibreOffice is the larger and
# more entangled half (fonts, filters, a pre-warmed profile), so adding a
# browser to it is the smaller edit.
#
# Chromium comes from Debian rather than from Playwright's downloader. Both
# work — `env:motion` resolves a browser by probing PLAYWRIGHT_BROWSERS_PATH,
# then playwright-core's registry, then the system paths — but the apt package
# is one transaction that also brings its own runtime libraries, and it is not
# tied to the playwright-core version the app happens to install. The launch
# already passes `--no-sandbox`, which is what a container needs.
FROM ghcr.io/porkytheblack/glovebox/docs:1.2

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# Both adapters resolve their binary by name/path at run time; naming them
# here means an app never has to configure either.
ENV GLOVEBOX_BASE_IMAGE=glovebox/studio \
    GLOVEBOX_BASE_VERSION=1.0 \
    GLOVE_CHROMIUM_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium

USER glovebox
