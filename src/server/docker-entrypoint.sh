#!/bin/sh
set -e

echo "[podium] applying database migrations"
npx prisma migrate deploy

if [ "$SEED_ON_BOOT" = "true" ]; then
  echo "[podium] seeding demo data"
  node dist/prisma/seed.js || echo "[podium] seed skipped"
fi

echo "[podium] starting API"
exec node dist/src/main.js
