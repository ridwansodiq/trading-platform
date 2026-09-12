# syntax=docker/dockerfile:1

# Built from the repository root so the workspace lockfile is in context:
#   docker build -f backend/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /repo

# Manifests first, so a dependency install is cached until one of them changes.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# The root postinstall generates the Prisma client, so the schema has to be in
# the context before the install rather than after it.
COPY backend/prisma/ backend/prisma/
RUN npm ci --workspace backend --include-workspace-root

COPY tsconfig.base.json ./
COPY backend/ backend/

# The client is generated from the schema, so it must exist before compiling.
# `build` also emits the seed to dist/prisma, so the image can seed itself
# without shipping tsx.
RUN npm run db:generate --workspace backend \
 && npm run build --workspace backend

# Reinstall without dev dependencies, keeping the generated client.
RUN npm ci --workspace backend --include-workspace-root --omit=dev \
 && npm run db:generate --workspace backend

# The SPA is built here and served by the API, so the whole app is one origin
# and one container. `--ignore-scripts` skips the root postinstall: the
# frontend needs no Prisma client.
FROM node:22-alpine AS frontend
WORKDIR /repo

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY frontend/ frontend/
RUN npm run build --workspace frontend

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# The hoisted workspace tree. It carries the generated client, the runtime
# dependencies, and the Prisma CLI the entrypoint uses to migrate — the CLI
# survives `--omit=dev` only because @prisma/client declares it an optional
# peer, which makes it `devOptional` rather than `dev`. That is an npm
# resolution detail, not a promise, hence the assertion below.
COPY --from=build /repo/node_modules node_modules/
COPY --from=build /repo/package.json ./
COPY --from=build /repo/backend/package.json backend/
COPY --from=build /repo/backend/dist backend/dist/
COPY --from=build /repo/backend/prisma backend/prisma/
# So the CLI resolves the schema here exactly as it does in development. It
# loads dotenv, which no-ops without a .env — compose supplies the real thing.
COPY --from=build /repo/backend/prisma.config.ts backend/
COPY --from=frontend /repo/frontend/dist frontend/dist/
COPY --chmod=0755 backend/docker-entrypoint.sh /usr/local/bin/entrypoint.sh

# Fail the build, not the deployment, if the migration CLI did not survive.
RUN node -e "require.resolve('prisma/package.json')"

# Never run as root; the image needs no write access to its own files.
USER node

EXPOSE 3001

# Fastify listens on 0.0.0.0 and closes its SSE streams on SIGTERM, so the
# signal has to reach the process rather than a shell wrapper — the entrypoint
# ends in `exec` for exactly that reason.
WORKDIR /repo/backend
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/server.js"]
