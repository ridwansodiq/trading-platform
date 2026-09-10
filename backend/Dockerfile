# syntax=docker/dockerfile:1

# Built from the repository root so the workspace lockfile is in context:
#   docker build -f backend/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /repo

# Manifests first, so a dependency install is cached until one of them changes.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root

COPY tsconfig.base.json ./
COPY backend/ backend/

# The client is generated from the schema, so it must exist before compiling.
RUN npm run db:generate --workspace backend \
 && npm run build --workspace backend

# Reinstall without dev dependencies, keeping the generated client.
RUN npm ci --workspace backend --include-workspace-root --omit=dev \
 && npm run db:generate --workspace backend

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Migrations ship with the image: `npm run db:deploy -w backend` applies them,
# and the Prisma CLI they need is a production dependency of the workspace.
COPY --from=build /repo/node_modules node_modules/
COPY --from=build /repo/package.json ./
COPY --from=build /repo/backend/package.json backend/
COPY --from=build /repo/backend/node_modules backend/node_modules/
COPY --from=build /repo/backend/dist backend/dist/
COPY --from=build /repo/backend/prisma backend/prisma/

# Never run as root; the image needs no write access to its own files.
USER node

EXPOSE 3001

# Fastify listens on 0.0.0.0 and closes its SSE streams on SIGTERM, so the
# signal has to reach the process rather than a shell wrapper.
WORKDIR /repo/backend
CMD ["node", "dist/server.js"]
