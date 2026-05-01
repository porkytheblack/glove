# glovebox/docs — base + document tooling.
#
# pdftk, pandoc, qpdf, libreoffice headless. Surfaces @pdfwright and
# @docconverter mentions for high-fidelity document manipulation.
FROM ghcr.io/porkytheblack/glovebox/base:1.0

USER root

# libreoffice and texlive-xetex are heavy. Split into two RUN layers so
# rebuilds for one don't invalidate the other.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      pandoc \
      qpdf \
      pdftk-java \
      poppler-utils \
      ghostscript \
      wkhtmltopdf \
 && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fonts-dejavu \
      fonts-liberation \
      fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*

# Pre-warm libreoffice's user profile so first-run isn't slow per request.
RUN su glovebox -c "libreoffice --headless --terminate_after_init || true"

ENV GLOVEBOX_BASE_IMAGE=glovebox/docs \
    GLOVEBOX_BASE_VERSION=1.2 \
    HOME=/home/glovebox

USER glovebox
