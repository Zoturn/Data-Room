#!/usr/bin/env bash
# PostToolUse(Bash): after `openspec archive`, verify that the documentation still tells the truth.
#
# This is the "check and update all information after every merge" requirement, enforced rather
# than written down: validate the folded specs, prove every rule path in every CLAUDE.md resolves,
# flag a CLAUDE.md that has grown implementation detail, and name the README sections the archived
# change owns.
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
  *"openspec archive"*) ;;
  *) exit 0 ;;
esac

repo=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$repo" || exit 0

report=""
add() { report="$report
- $1"; }

# 1. The folded specs must still validate.
if command -v openspec >/dev/null 2>&1; then
  if ! openspec validate --all --strict >/dev/null 2>&1; then
    add "\`openspec validate --all --strict\` FAILS after the archive. Fix the specs before anything else."
  fi
fi

# 2. Every rule path referenced from a CLAUDE.md must exist, resolved relative to that file.
broken=$(mktemp)
for claude in CLAUDE.md apps/web/CLAUDE.md apps/api/CLAUDE.md; do
  [ -f "$claude" ] || { add "$claude is missing."; continue; }
  base=$(dirname "$claude")

  grep -oE '[A-Za-z0-9_./-]*\.claude/rules/[A-Za-z0-9_-]+\.md' "$claude" | sort -u | while read -r ref; do
    [ -f "$base/$ref" ] || printf '%s|%s\n' "$claude" "$ref" >> "$broken"
  done

  # 3. A CLAUDE.md is orientation only. Growth means detail has leaked in.
  lines=$(wc -l < "$claude" | tr -d ' ')
  [ "$lines" -gt 120 ] && add "$claude is $lines lines. It should carry general information and a rule index only — move detail into a rule."
  if grep -qE '^\s*```(ts|tsx|js|prisma|sql)' "$claude"; then
    add "$claude contains code examples. Examples belong in a rule, not in a CLAUDE.md."
  fi
done

while IFS='|' read -r where ref; do
  [ -n "$where" ] && add "$where references $ref, which does not exist."
done < "$broken"
rm -f "$broken"

# 4. Rules that no CLAUDE.md indexes are invisible to a reader.
for rule in $(find . -path ./node_modules -prune -o -path '*/.claude/rules/*.md' -print 2>/dev/null); do
  name=$(basename "$rule")
  grep -qr "$name" CLAUDE.md apps/web/CLAUDE.md apps/api/CLAUDE.md 2>/dev/null \
    || add "$rule is not listed in any CLAUDE.md rule index."
done

# 5. The README carries the graded deliverables; an archive is when they go stale.
if [ -f README.md ]; then
  for section in "How it scales" "Data model" "Setup" "Hosted URLs" "AI"; do
    grep -qi "$section" README.md || add "README.md has no \"$section\" section."
  done
  add "Re-read README.md: setup steps, environment variables, ERD and the hosted URLs must match what was just archived."
fi

[ -n "$report" ] || exit 0

message="Docs-sync after archive — resolve each of these now, not later:$report"

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg c "$message" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
else
  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' "$message"
fi
exit 0
