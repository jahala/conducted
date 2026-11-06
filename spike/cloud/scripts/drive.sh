#!/usr/bin/env bash
# CLOUD-02 spike: bundles driver/drive.ts (with the desktop repositories and the protocol it
# imports) into /tmp/conducted-spike-cloud and runs it with Node from spike/cloud.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p /tmp/conducted-spike-cloud
"$here/node_modules/.bin/esbuild" "$here/driver/drive.ts" --bundle --platform=node --format=esm \
	--target=node24 --log-level=warning --outfile=/tmp/conducted-spike-cloud/drive.mjs
cd "$here"
exec node /tmp/conducted-spike-cloud/drive.mjs "$@"
