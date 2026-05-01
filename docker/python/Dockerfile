# glovebox/python — base + Python data toolchain.
#
# uv (fast pip), numpy, pandas, pillow. Surfaces @analyst as a data-analysis
# subagent.
FROM ghcr.io/porkytheblack/glovebox/base:1.0

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      python3-dev \
      build-essential \
 && rm -rf /var/lib/apt/lists/*

# uv is the fast resolver/installer. We install via the upstream script
# rather than apt — the apt package is years old.
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && mv /root/.local/bin/uv /usr/local/bin/uv \
 && mv /root/.local/bin/uvx /usr/local/bin/uvx

# Pre-install the common scientific stack so cold start is fast.
# Use --break-system-packages because Debian's PEP 668 marks the system
# Python as externally managed; in this container we own it.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
      "numpy>=2.0" \
      "pandas>=2.2" \
      "pillow>=10.0" \
      "scipy>=1.13" \
      "matplotlib>=3.9"

ENV GLOVEBOX_BASE_IMAGE=glovebox/python \
    GLOVEBOX_BASE_VERSION=1.3 \
    PIP_BREAK_SYSTEM_PACKAGES=1

USER glovebox
