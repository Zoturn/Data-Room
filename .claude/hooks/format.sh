#!/usr/bin/env bash
# PostToolUse(Write|Edit): format the file that was just written with the workspace's own Prettier.
#
# Walks up from the edited file to the nearest node_modules/.bin/prettier and runs it from that
# directory, so apps/web and apps/api each pick up their own .prettierrc and .prettierignore.
# Exits 0 silently when no local prettier exists, so a fresh clone with no node_modules is fine.
set -u

read_path() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.tool_response.filePath // .tool_input.file_path // empty'
  else
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_response&&j.tool_response.filePath)||(j.tool_input&&j.tool_input.file_path)||"")}catch(e){}})'
  fi
}

file=$(read_path)
[ -n "$file" ] || exit 0

file=${file//\\//}          # Windows paths arrive backslash-separated
[ -f "$file" ] || exit 0

dir=$(cd "$(dirname "$file")" 2>/dev/null && pwd) || exit 0
abs="$dir/$(basename "$file")"

while :; do
  if [ -x "$dir/node_modules/.bin/prettier" ]; then
    cd "$dir" || exit 0
    ./node_modules/.bin/prettier --write --ignore-unknown "${abs#"$dir"/}" >/dev/null 2>&1
    exit 0
  fi
  parent=$(dirname "$dir")
  [ "$parent" = "$dir" ] && break
  dir=$parent
done

exit 0
