#!/bin/sh
# Gives this worktree its own local Supabase: writes supabase/.env (git-ignored)
# with a project id and ports no other worktree of this repo uses.
# Safe to run again: an existing supabase/.env is kept.
set -eu
root=$(git rev-parse --show-toplevel)
env_file="$root/supabase/.env"
if [ -f "$env_file" ]; then
  echo "kept $env_file"; exit 0
fi
# Slots already taken by the other worktrees of this repo.
used=$(git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do
  sed -n 's/^SUPABASE_PROJECT_ID=ezeli-wt//p' "$w/supabase/.env" 2>/dev/null || true
done)
slot=1
while printf '%s\n' "$used" | grep -qx "$slot"; do slot=$((slot + 1)); done
base=$((54300 + slot * 100))
cat > "$env_file" <<ENV
SUPABASE_PROJECT_ID=ezeli-wt$slot
SUPABASE_API_PORT=$((base + 21))
SUPABASE_DB_PORT=$((base + 22))
SUPABASE_DB_SHADOW_PORT=$((base + 20))
ENV
echo "wrote $env_file (slot $slot, API port $((base + 21)))"
