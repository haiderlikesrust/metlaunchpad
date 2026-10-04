# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 THICC_RUNTIME=node
RUN npm run build:dokploy

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production THICC_RUNTIME=node HOSTNAME=0.0.0.0 PORT=3187 DATABASE_PATH=/data/thicc.sqlite NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next-dokploy/standalone/ ./
COPY --from=build --chown=node:node /app/.next-dokploy/static/ ./.next-dokploy/static/
COPY --from=build --chown=node:node /app/public/ ./public/
COPY --chown=node:node deploy/ ./deploy/
COPY --chown=node:node drizzle/ ./drizzle/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3187
CMD ["node", "deploy/start.mjs"]
