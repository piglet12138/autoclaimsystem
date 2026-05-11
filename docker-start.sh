#!/bin/sh
# Run database migrations before starting the app
echo "[startup] Running database migrations..."
NODE_PATH=./node_modules_full node node_modules_full/.bin/prisma migrate deploy 2>&1 || echo "[startup] Migration failed or already up to date"
echo "[startup] Starting application..."
exec node server.js
