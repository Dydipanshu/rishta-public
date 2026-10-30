#!/usr/bin/env bash
# A real local Postgres for testing, with no install or root needed.
set -euo pipefail
BIN=$(ls -d node_modules/.pnpm/@embedded-postgres+linux-x64*/node_modules/@embedded-postgres/linux-x64/native/bin)
DIR=${1:-data/pg}
[ -f "$DIR/PG_VERSION" ] || "$BIN/initdb" -D "$DIR" -U rishta --locale=C --encoding=UTF8 -A trust >/dev/null
"$BIN/pg_ctl" -D "$DIR" -w -l data/pg.log -o "-p 15432 -k /tmp -c max_connections=200" start
"$BIN/postgres" --version
echo "DATABASE_URL=postgres://rishta@localhost:15432/postgres"
