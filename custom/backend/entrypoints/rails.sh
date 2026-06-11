#!/bin/sh

set -x

# Remove a potentially pre-existing server.pid for Rails.
rm -rf /app/tmp/pids/server.pid
rm -rf /app/tmp/cache/*

echo "Waiting for postgres to become ready...."

# Let DATABASE_URL env take presedence over individual connection params.
$(docker/entrypoints/helpers/pg_database_url.rb)
PG_READY="pg_isready -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USERNAME"

until $PG_READY
do
  sleep 2;
done

echo "Database ready to accept connections."

#install missing gems for local dev as we are using base image compiled for production
bundle install

BUNDLE="bundle check"

until $BUNDLE
do
  sleep 2;
done

# ── AUTO MIGRATE ─────────────────────────────────────────────────────────────
# Automatically run migrations on every container start.
# This ensures new columns/tables are always applied without manual steps.
echo "Running database migrations..."
bundle exec rails db:migrate
echo "Migrations complete."
# ─────────────────────────────────────────────────────────────────────────────

# ── AUTO-PATCH JS ────────────────────────────────────────────────────────────
# Re-apply voice call JS patches after every restart.
# The compiled JS filename may change between image updates — patch_master.rb
# auto-detects the right file via grep for VOICE-WIDGET/ElevenLabs strings.
if [ -f /app/patch_master.rb ]; then
  echo "Applying voice call JS patches..."
  ruby /app/patch_master.rb && echo "JS patches applied." || echo "JS patch failed (non-fatal)."
fi
# ─────────────────────────────────────────────────────────────────────────────

# Execute the main process of the container
exec "$@"
