#!/bin/sh
set -eu

mkdir -p /app/data /app/public/generated

npx prisma db push

exec npm run start
