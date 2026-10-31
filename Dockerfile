# The public site as one container. No outside database: seeded test data is baked in at build,
# and each visitor gets a private SQLite copy on the container's disk (wiped on restart).
# Runs as uid 1000 and listens on $PORT, so it fits Hugging Face Spaces, Render or a laptop.
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN mkdir -p data && SKIP_KEYS=1 pnpm seed && pnpm exec tsx scripts/buildVisitorTemplate.ts

FROM node:24-slim
WORKDIR /app
RUN chown node:node /app
ENV PUBLIC_SITE=true PORT=7860 NODE_ENV=production
COPY --from=build --chown=node:node /app .
USER node
EXPOSE 7860
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
