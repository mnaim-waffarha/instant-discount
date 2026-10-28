# Web app (admin + partner portal), Next.js standalone output. Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile -t instant-discount-web .
# One image for every environment: API_URL, GOOGLE_CLIENT_ID and DEV_LOGIN are read at runtime.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @instant-discount/web...
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @instant-discount/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
