#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/dist-standalone"
ARCHIVE_PATH="${ROOT_DIR}/imagegen-platform-standalone.tar.gz"

cd "${ROOT_DIR}"

rm -rf "${OUTPUT_DIR}" "${ARCHIVE_PATH}"

npm run build

mkdir -p "${OUTPUT_DIR}"

cp -R .next/standalone/. "${OUTPUT_DIR}/"
mkdir -p "${OUTPUT_DIR}/.next"
cp -R .next/static "${OUTPUT_DIR}/.next/static"

mkdir -p "${OUTPUT_DIR}/data" "${OUTPUT_DIR}/public/generated" "${OUTPUT_DIR}/prisma"

cp prisma/schema.prisma "${OUTPUT_DIR}/prisma/schema.prisma"

tar -czf "${ARCHIVE_PATH}" -C "${OUTPUT_DIR}" .

echo "Standalone package ready:"
echo "  ${ARCHIVE_PATH}"
