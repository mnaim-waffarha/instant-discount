#!/usr/bin/env bash
# Generates the API docs from the code (OpenAPI specs, HTML reference, endpoint index).
#   scripts/api-docs.sh          write docs/api/*
#   scripts/api-docs.sh --check  fail if docs/api is out of date, or the specs do not lint (CI)
set -euo pipefail
cd "$(dirname "$0")/.."
REDOCLY="$PWD/node_modules/.bin/redocly"

npx tsx src/openapi/generate.ts "$@"
(cd ../../docs/api && "$REDOCLY" lint --format=summary)
