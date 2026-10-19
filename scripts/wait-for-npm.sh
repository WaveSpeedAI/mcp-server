#!/usr/bin/env bash
# Wait until the npm package listed in server.json can be fetched from the npm registry.
#
# The MCP registry checks that the npm version exists before it accepts a release, and
# `npm publish` returns before every npm replica serves the new version (on 2026-10-19 the
# first registry attempt ran about 80 seconds early and was refused). Polling here turns
# that race into a short wait instead of a failed release.
#
#   scripts/wait-for-npm.sh [server.json]
#   NPM_WAIT_ATTEMPTS (default 60)  NPM_WAIT_SLEEP seconds (default 10)  NPM_REGISTRY_URL
set -euo pipefail

server_json="${1:-server.json}"
attempts="${NPM_WAIT_ATTEMPTS:-60}"
pause="${NPM_WAIT_SLEEP:-10}"
registry="${NPM_REGISTRY_URL:-https://registry.npmjs.org}"

name="$(jq -er '[.packages[] | select(.registryType == "npm")][0].identifier' "$server_json")"
version="$(jq -er '[.packages[] | select(.registryType == "npm")][0].version' "$server_json")"
url="$registry/${name//\//%2f}/$version"

for ((attempt = 1; attempt <= attempts; attempt++)); do
  if curl -fsS -o /dev/null "$url"; then
    echo "$name@$version is visible on npm (attempt $attempt)"
    # A different replica may answer the registry's own check; give it a moment.
    sleep "$pause"
    exit 0
  fi
  echo "waiting for $name@$version on npm (attempt $attempt/$attempts)"
  sleep "$pause"
done
echo "$name@$version did not appear on npm after $attempts attempts" >&2
exit 1
