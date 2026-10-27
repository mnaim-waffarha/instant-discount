# Web app (admin + partner portal), Next.js standalone output. Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=... -t instant-discount-web .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @instant-discount/web...
# Public values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_DEV_LOGIN=false
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID NEXT_PUBLIC_DEV_LOGIN=$NEXT_PUBLIC_DEV_LOGIN NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @instant-discount/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
# API_URL (e.g. http://api:3000) is read at runtime by the /api proxy route.
CMD ["node", "apps/web/server.js"]
