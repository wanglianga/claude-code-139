#!/bin/sh
set -e

# 等待 PostgreSQL 就绪
echo "Waiting for database ${DB_HOST}:${DB_PORT}..."
until node -e "
const net = require('net');
const s = net.connect({ host: process.env.DB_HOST || 'db', port: Number(process.env.DB_PORT || 5432) });
s.on('connect', () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
" 2>/dev/null; do
  sleep 1
done
echo "Database is up."

# 可选：初始化种子数据（默认开启，重复执行幂等）
if [ "${SEED:-true}" = "true" ]; then
  echo "Running seed (idempotent)..."
  node seed/seed.js || echo "seed skipped/failed (may already be seeded)"
fi

exec node dist/main.js
