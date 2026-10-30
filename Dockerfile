FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
ENV APP_ENV=production
COPY --from=build --chown=node:node /app .
RUN mkdir -p data && chown node:node /app data
USER node
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
