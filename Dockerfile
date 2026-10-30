# Node is pinned to an exact release so a rebuild never drifts to an old or
# unpatched one. 24.22.1 is the Oct 20 2026 security release (Brotli RCE,
# TLS hostname checks, dns.resolve). Nixpacks' frozen package set had this
# service on Node 24.10.0 (Oct 2025).
# Railway service variables reach the app at runtime only; none are baked
# into the image (Nixpacks used to copy every one into ARG/ENV lines).
FROM node:24.22.1-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Same installer Nixpacks used (pnpm 9, frozen lockfile).
RUN npm install -g pnpm@9.15.9 && pnpm install --frozen-lockfile
# Fish speed goes through Praat (fish-stretch.js; FISH_SPEED_EXACT=1 everywhere, FISH_PACE_STRETCH=1 chat at Brisk and Quick). Exact
# pins, wheels only, proven for cp311 manylinux x86_64 on Oct 30 2026 (numpy 2.5 has no Python 3.11
# wheel). The import line fails the build, and so keeps the running deploy, if the install is broken.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/fish-stretch \
  && /opt/fish-stretch/bin/pip install --no-cache-dir --only-binary=:all: praat-parselmouth==0.4.7 numpy==2.4.6 \
  && /opt/fish-stretch/bin/python -I -c "import numpy, parselmouth"
ENV FISH_STRETCH_PYTHON=/opt/fish-stretch/bin/python
COPY . .
CMD ["npm", "start"]
