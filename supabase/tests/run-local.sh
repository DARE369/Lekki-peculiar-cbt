#!/usr/bin/env bash
# Apply shim + migrations + tests to a throwaway local Postgres database.
# Usage: PGHOST=/var/tmp/pgcbt PGPORT=54329 supabase/tests/run-local.sh
set -euo pipefail
DB=${DB:-cbt_test}
cd "$(dirname "$0")/../.."
psql -U postgres -qc "drop database if exists $DB" -c "create database $DB"
P="psql -X -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
$P -f supabase/tests/local_shim.sql
for f in supabase/migrations/*.sql; do echo "migrate: $f"; $P -f "$f" > /dev/null; done
for f in supabase/tests/*.test.sql; do echo "test: $f"; $P -f "$f" > /dev/null; done
echo "all database tests passed"
