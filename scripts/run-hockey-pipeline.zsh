#!/bin/zsh
# Keep EP's existing export, Shiny deployment and Telegram steps intact.
set -e
if (( $# > 1 )) || { (( $# == 1 )) && [[ "$1" != "--upload-only" ]]; }; then
  print -u2 "Usage: zsh scripts/run-hockey-pipeline.zsh [--upload-only]"
  exit 2
fi
HUB_ROOT="${0:A:h:h}"
HOCKEY_ROOT="${HOCKEY_MODEL_ROOT:-${HUB_ROOT:h}/EP-HOCKEY-DB-MODELS}"
NODE_BIN="${HOCKEY_NODE_BIN:-$(command -v node || true)}"
# The desktop runtime may provide Node when it is not installed on PATH.
if [[ -z "$NODE_BIN" ]]; then
  for candidate in "$HOME/Library/Application Support/Codex/artifact-sessions/runtime-generations/"*/runtime/bin/node(N); do
    [[ -x "$candidate" ]] && NODE_BIN="$candidate"
  done
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  print -u2 "Set HOCKEY_NODE_BIN to your Node executable before running the combined pipeline."
  exit 1
fi
if [[ "${1:-}" != "--upload-only" ]]; then
  zsh "$HOCKEY_ROOT/RUNMODEL.txt"
fi
"$NODE_BIN" "$HUB_ROOT/scripts/publish-hockey-future-games.cjs" --hockey-root "$HOCKEY_ROOT"
