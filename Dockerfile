FROM node:20-alpine AS base
RUN npm install -g pnpm@8.12.1
RUN apk add --no-cache wget

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /app
COPY pnpm-*.yaml ./
COPY package.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm --filter @delivery-tracker/server build-with-deps

FROM base
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-*.yaml ./
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/dist ./packages/server/dist

RUN pnpm install --prod --no-frozen-lockfile

WORKDIR /app/packages/server

ENV NODE_ENV=production
ENV DEBUG=*
ENV PORT=4000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/ || exit 1

EXPOSE 4000
CMD ["node", "dist/index.js"]
