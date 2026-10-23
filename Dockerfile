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
COPY . .
CMD ["npm", "start"]
