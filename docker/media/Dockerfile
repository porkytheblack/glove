# glovebox/media — base + media tooling.
#
# ffmpeg, imagemagick, sox, yt-dlp. The @transcoder mention surfaces an
# ffmpeg-expert subagent at runtime via glovebox-kit's base-mention registry.
FROM ghcr.io/porkytheblack/glovebox/base:1.0

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      imagemagick \
      sox \
      libsox-fmt-all \
      python3 \
      python3-pip \
      python3-venv \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp is fast-moving — pull from PyPI so it tracks upstream.
RUN python3 -m pip install --no-cache-dir --break-system-packages yt-dlp

# Loosen ImageMagick's default policy so PDF→raster and other common
# conversions actually work. The agent runs as a non-root user with no
# network access by default; this is a safe relaxation in our threat model.
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' \
      /etc/ImageMagick-6/policy.xml || true

ENV GLOVEBOX_BASE_IMAGE=glovebox/media \
    GLOVEBOX_BASE_VERSION=1.4

USER glovebox
