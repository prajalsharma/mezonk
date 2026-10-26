# Testnet market-maker bot (apps/web/scripts/market-maker.ts) as an always-on worker.
# Secrets come from the host's environment (MM_PRIVATE_KEY), never from this image or the repo.
FROM node:22-slim
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web --prod=false --ignore-scripts
COPY apps/web apps/web
WORKDIR /app/apps/web
USER node
# tsx directly (not `pnpm mm`), so nothing is downloaded at start-up.
CMD ["./node_modules/.bin/tsx", "scripts/market-maker.ts"]
