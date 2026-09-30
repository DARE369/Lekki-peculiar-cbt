#!/usr/bin/env bash
# Fresh local stack + production build + end-to-end tests.
#   PGHOST=/var/tmp/pgcbt PGPORT=54329 e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/local-supabase/start.sh > /tmp/cbt-stack.log 2>&1
if ! curl -sf -o /dev/null http://localhost:3000/login; then
  echo "Start the app first: pnpm build && pnpm start" >&2
  exit 1
fi
npx playwright test "$@"
