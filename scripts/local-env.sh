#!/bin/sh
# Points the app and the owner commands at this worktree's running local Supabase.
#   - writes .env.local (git-ignored) with the two values the app needs, both public
#   - prints export lines for the owner commands, with the secret key. The secret key is
#     never written to a file: use  eval "$(sh scripts/local-env.sh)"
set -eu
status=$(pnpm exec supabase status -o env 2>/dev/null)
value() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
url=$(value API_URL)
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_PUBLISHABLE_KEY=%s\n' "$url" "$(value PUBLISHABLE_KEY)" > .env.local
port=$(( 5173 + ${url##*:} - 54321 ))
echo "export SUPABASE_URL=$url"
echo "export SUPABASE_SECRET_KEY=$(value SECRET_KEY)"
echo "export EZELI_APP_URL=http://127.0.0.1:$port"
echo "# the app: pnpm dev --host 127.0.0.1 --port $port" >&2
