#!/usr/bin/env bash
# Local Supabase without Docker: Postgres 16 + PostgREST + GoTrue + a tiny gateway.
# For development and end-to-end tests only. Storage (photos) is not emulated.
#
#   PGHOST=/var/tmp/pgcbt PGPORT=54329 scripts/local-supabase/start.sh
#
# Then put the printed variables in .env.local and run `pnpm dev`.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
TOOLS=${TOOLS:-/var/tmp/sbtools}
DB=${DB:-cbt_dev}
JWT_SECRET=${JWT_SECRET:-local-dev-jwt-secret-with-at-least-32-characters}
PGHOST=${PGHOST:-/var/tmp/pgcbt}
PGPORT=${PGPORT:-54329}
export PGHOST PGPORT

# Stop anything left from a previous run.
pkill -x postgrest 2>/dev/null || true
pkill -x auth 2>/dev/null || true
pkill -f "^node proxy.mjs" 2>/dev/null || true
pkill -f "^node mail-sink.mjs" 2>/dev/null || true
sleep 1

mkdir -p "$TOOLS"
if [ ! -x "$TOOLS/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C "$TOOLS"
fi
if [ ! -x "$TOOLS/auth" ]; then
  curl -sSL https://github.com/supabase/auth/releases/download/v2.170.0/auth-v2.170.0-x86.tar.gz | tar xz -C "$TOOLS"
fi

if [ "${RESET:-1}" = "1" ]; then
  psql -U postgres -qc "drop database if exists $DB" -c "create database $DB"
  sed "s/current_database_placeholder/$DB/" roles.sql | psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1

  (cd "$TOOLS" && GOTRUE_DB_DRIVER=postgres \
    DATABASE_URL="postgres://supabase_auth_admin@localhost:$PGPORT/$DB?host=$PGHOST&search_path=auth" \
    GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin@localhost:$PGPORT/$DB?host=$PGHOST&search_path=auth" \
    GOTRUE_JWT_SECRET="$JWT_SECRET" API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:3000 \
    ./auth migrate >/dev/null)

  for f in "$ROOT"/supabase/migrations/*.sql; do psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"; done
  echo "database $DB ready"
fi

LOGS=${LOGS:-/var/tmp/sblogs}
mkdir -p "$LOGS"
# Local email: a sink that saves messages to $LOGS/mail and serves the real invite template.
rm -rf "$LOGS/mail"
MAIL_DIR="$LOGS/mail" nohup node mail-sink.mjs </dev/null >"$LOGS/mail-sink.log" 2>&1 &
PGRST_DB_URI="postgres://authenticator@localhost:$PGPORT/$DB?host=$PGHOST" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=54331 PGRST_DB_POOL=20 \
  nohup "$TOOLS/postgrest" </dev/null >"$LOGS/postgrest.log" 2>&1 &
(cd "$TOOLS" && GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin@localhost:$PGPORT/$DB?host=$PGHOST&search_path=auth" \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  GOTRUE_JWT_ADMIN_ROLES=service_role API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:3000 \
  GOTRUE_EXTERNAL_GOOGLE_ENABLED=true GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=local-test.apps.googleusercontent.com \
  GOTRUE_EXTERNAL_GOOGLE_SECRET=local-test-secret GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback \
  GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" \
  GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2525 GOTRUE_SMTP_USER=sink GOTRUE_SMTP_PASS=sink GOTRUE_SMTP_ADMIN_EMAIL=noreply@lps.test \
  GOTRUE_MAILER_TEMPLATES_INVITE=http://127.0.0.1:8899/invite.html GOTRUE_MAILER_SUBJECTS_INVITE="You're invited to Peculiar CBT" \
  GOTRUE_MAILER_TEMPLATES_RECOVERY=http://127.0.0.1:8899/reset-password.html GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://127.0.0.1:8899/magic-link.html \
  GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify GOTRUE_MAILER_URLPATHS_MAGIC_LINK=/auth/v1/verify GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_SMTP_MAX_FREQUENCY=1s \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=false PORT=54332 GOTRUE_API_HOST=127.0.0.1 \
  nohup ./auth serve </dev/null >"$LOGS/gotrue.log" 2>&1 &)
nohup node proxy.mjs </dev/null >"$LOGS/proxy.log" 2>&1 &
sleep 2

echo
echo "# .env.local"
echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
(cd "$ROOT" && JWT_SECRET="$JWT_SECRET" node scripts/local-supabase/keys.mjs)
echo "EXAM_TOKEN_SECRET=local-exam-token-secret-at-least-32-chars"
echo "SETUP_SECRET=local-setup"
echo "SMTP_HOST=127.0.0.1"
echo "SMTP_PORT=2525"
echo "SMTP_USER=sink"
echo "SMTP_PASS=sink"
echo "SMTP_FROM=noreply@lps.test"
