#!/bin/sh
#
# Startup for the container image: bring the schema and demo data up to date,
# then hand PID 1 to the server.
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Applying migrations..."
  npx prisma migrate deploy
fi

if [ "$RUN_SEED" = "true" ]; then
  # The compiled seed, because tsx is a dev dependency and is not in this
  # image. It is idempotent: users are upserted and trades are left alone
  # unless SEED_RESET=true, so restarting the stack does not duplicate a book.
  echo "Seeding demo data..."
  node dist/prisma/seed.js
fi

# exec, so SIGTERM reaches Fastify and it can drain its SSE streams instead of
# being killed at the end of the stop grace period.
exec "$@"
