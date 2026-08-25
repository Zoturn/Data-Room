#!/usr/bin/env bash
# PostToolUse(Write|Edit): after a source file changes, report whether its tests need attention.
#
# Never blocks. Emits additionalContext when the companion spec is missing or older than the
# source, so the tests get written or updated alongside the change rather than "later".
set -u

payload=$(cat)

field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$1 // empty"
  else
    printf '%s' "$payload" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=$2;process.stdout.write(v||'')}catch(e){}})"
  fi
}

file=$(field '.tool_response.filePath // .tool_input.file_path' "(j.tool_response&&j.tool_response.filePath)||(j.tool_input&&j.tool_input.file_path)")
[ -n "$file" ] || exit 0
file=${file//\\//}
[ -f "$file" ] || exit 0

case "$file" in
  */apps/api/src/*|*/apps/web/src/*|*/packages/shared/src/*) ;;
  *) exit 0 ;;
esac

# Not source worth testing: tests themselves, type-only files, barrels, config, generated code.
case "$file" in
  *.spec.ts|*.spec.tsx|*.cy.ts|*.cy.tsx) exit 0 ;;
  *.d.ts|*/index.ts|*.config.ts|*.module.ts) exit 0 ;;
  */migrations/*|*/generated/*) exit 0 ;;
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

base=${file%.*}
ext=${file##*.}
spec="$base.spec.$ext"

emit() {
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg c "$1" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
  else
    node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' "$1"
  fi
  exit 0
}

if [ ! -f "$spec" ]; then
  emit "No test file exists for $(basename "$file"). Decide whether this file warrants tests; if it does, create ${spec##*/} beside it (Jest for logic, Cypress component tests for React components — no other runners). If it genuinely does not, say why."
fi

if [ "$file" -nt "$spec" ]; then
  emit "$(basename "$file") is newer than its test ${spec##*/}. Check whether this edit added behaviour the existing tests do not cover — new branches, new error paths, new props — and extend the spec accordingly."
fi

exit 0
