# syntax=docker/dockerfile:1
FROM node:24.18.0-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM base AS runtime-assets
WORKDIR /runtime
COPY runtime/package.json runtime/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV="production"
ENV PORT="3000"
ENV HOSTNAME="0.0.0.0"
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/.next/runtime/production.js ./production.js
COPY --from=build --chown=nextjs:nodejs /app/.next/runtime/background.js ./background.js
COPY --from=build --chown=nextjs:nodejs /app/.next/runtime/migrate.js ./migrate.js
COPY --from=build --chown=nextjs:nodejs /app/.next/runtime/digest.js ./digest.js
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=runtime-assets --chown=nextjs:nodejs /runtime/node_modules ./node_modules
USER nextjs
EXPOSE 3000
CMD ["node", "production.js"]
