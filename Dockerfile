FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
ENV APP_ENV=production
COPY --from=build /app .
USER node
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
