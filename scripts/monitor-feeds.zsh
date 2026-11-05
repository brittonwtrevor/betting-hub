#!/bin/zsh
set -e
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
FEED_MONITOR_RUNTIME="${FEED_MONITOR_NODE:-${HOCKEY_NODE_BIN:-$(command -v node || true)}}"
if [[ -z "$FEED_MONITOR_RUNTIME" ]]; then
  for candidate in "$HOME/Library/Application Support/Codex/artifact-sessions/runtime-generations/"*/runtime/bin/node(N) \
    /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node; do
    [[ ! -x "$candidate" ]] || FEED_MONITOR_RUNTIME="$candidate"
  done
fi
if [[ -z "$FEED_MONITOR_RUNTIME" || ! -x "$FEED_MONITOR_RUNTIME" ]]; then
  print -u2 'Set FEED_MONITOR_NODE to a Node 20.12+ executable.'
  exit 1
fi
exec "$FEED_MONITOR_RUNTIME" "${0:A:h}/feed-monitor.cjs" "$@"
