#!/bin/bash
# Optimize extension-exported GIFs for bundling: inter-frame diffing (-O3),
# escalating lossy compression only as far as needed to get under the budget.
set -euo pipefail
HARNESS="$(cd "$(dirname "$0")" && pwd)"
GIFSICLE="$HARNESS/node_modules/.bin/gifsicle"
SRC="$HARNESS/gifs"
OUT="$HARNESS/gifs-opt"
BUDGET=$((1500 * 1024))
mkdir -p "$OUT"

for f in "$SRC"/*.gif; do
  name="$(basename "$f")"
  out="$OUT/$name"
  for lossy in 30 60 90 120; do
    "$GIFSICLE" -O3 --lossy=$lossy --colors 192 "$f" -o "$out"
    size=$(stat -f%z "$out")
    if [ "$size" -le "$BUDGET" ]; then break; fi
  done
  size=$(stat -f%z "$out")
  printf "%-28s %5dkB -> %5dkB (lossy=%s)\n" "$name" $(( $(stat -f%z "$f") / 1024 )) $(( size / 1024 )) "$lossy"
done
