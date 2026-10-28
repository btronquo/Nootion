# syntax=docker/dockerfile:1
# Image unique de Nootion : API Fastify + interface web compilée. Données dans /data.

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 && pnpm --filter @nootion/server deploy --prod --legacy /out \
 && rm -rf /out/src /out/test /out/build.mjs /out/drizzle.config.ts /out/tsconfig.json /out/dist \
 && cp -r apps/server/dist apps/server/migrations /out/ \
 && cp -r apps/web/dist /out/web \
 && sed 's/\r$//' docker/entrypoint.sh > /out/entrypoint.sh

FROM node:22-bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="Nootion" \
      org.opencontainers.image.description="Prise de notes open source façon Notion, avec databases" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    NOOTION_VERSION=${VERSION} \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
