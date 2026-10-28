#!/usr/bin/env bash
# 로컬 Postgres 16 으로 schema.sql 권한 테스트 (Supabase 계정 없이)
set -euo pipefail
PG=${PG_BIN:-/usr/lib/postgresql/16/bin}; D=${PG_DIR:-/var/tmp/pgtest}; PORT=${PG_PORT:-54329}
cd "$(dirname "$0")/.."
rm -rf "$D" && mkdir -p "$D" && chown postgres "$D"
su postgres -c "$PG/initdb -D $D/data -A trust -U postgres >/dev/null && $PG/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log start >/dev/null"
trap 'su postgres -c "$PG/pg_ctl -D $D/data stop -m fast >/dev/null"' EXIT
sleep 2
cat test/stub.sql schema.sql schema.sql > "$D/all.sql"; cp test/test_rls.sql "$D/"; chmod 644 "$D"/*.sql
su postgres -c "psql -h $D -p $PORT -v ON_ERROR_STOP=1 -q -f $D/all.sql" >/dev/null 2>&1
su postgres -c "psql -h $D -p $PORT -q -f $D/test_rls.sql" 2>&1 | grep -E "통과|실패|ERROR|모든"
