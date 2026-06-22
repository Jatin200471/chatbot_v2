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

# NOTE: db:migrate removed — docker-compose command runs db:chatwoot_prepare
# which handles both fresh databases (db:setup with seeds) and existing ones
# (db:migrate). Running db:migrate here on a clean DB would create tables
# without seed data, preventing the super admin onboarding page from appearing.

# Execute the main process of the container
exec "$@"
