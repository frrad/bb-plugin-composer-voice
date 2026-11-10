#!/usr/bin/env bash
# Updates this repo to a new bb release. Usage: sync/sync.sh <tag>
set -euo pipefail
exec node "$(dirname "$0")/sync.mjs" "$@"
