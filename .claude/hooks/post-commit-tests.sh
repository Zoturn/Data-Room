#!/usr/bin/env bash
# PostToolUse(Bash): after a successful `git commit`, run the Jest suites of the affected workspaces.
#
# Reads the command from the hook payload, so it only fires on a real commit. Reports failures back
# into the session as additionalContext; a green run says nothing. No-ops when dependencies are
# not installed.
set -u

payload=$(cat)

json_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$1 // empty"
  else
    printf '%s' "$payload" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write($2||'')}catch(e){}})"
  fi
}

command_text=$(json_field '.tool_input.command' "j.tool_input&&j.tool_input.command")
case "$command_text" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo" || exit 0

# Only run when the commit actually landed.
git rev-parse HEAD >/dev/null 2>&1 || exit 0
changed=$(git show --name-only --pretty=format: HEAD 2>/dev/null)
[ -n "$changed" ] || exit 0

[ -d node_modules ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

workspaces=""
case "$changed" in *apps/api/*) workspaces="$workspaces @data-room/api" ;; esac
case "$changed" in *apps/web/*) workspaces="$workspaces @data-room/web" ;; esac
case "$changed" in *packages/shared/*) workspaces="@data-room/api @data-room/web @data-room/shared" ;; esac
[ -n "$workspaces" ] || exit 0

failures=""
for ws in $workspaces; do
  if ! output=$(pnpm --filter "$ws" test --silent 2>&1); then
    failures="$failures

--- $ws ---
$(printf '%s' "$output" | tail -40)"
  fi
done

[ -n "$failures" ] || exit 0

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg c "Jest failed after the commit. Fix these before moving on:$failures" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
else
  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' \
    "Jest failed after the commit. Fix these before moving on:$failures"
fi
exit 0
