# Testnet market-maker bot (apps/web/scripts/market-maker.ts) as an always-on worker.
# Secrets come from the host's environment (MM_PRIVATE_KEY), never from this image or the repo.
FROM node:22-slim
ENV NODE_ENV=production CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web --prod=false --ignore-scripts
COPY apps/web apps/web
USER node
CMD ["pnpm", "--filter", "web", "mm"]
