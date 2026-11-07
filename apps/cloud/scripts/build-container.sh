#!/usr/bin/env bash
# CLOUD-04: stages the product sandbox image's inputs beside apps/cloud/sandbox/Dockerfile: the
# Linux sidecar, the entry point and the app's three helper scripts. Wrangler builds that Dockerfile
# on deploy; this script only fills the folder it copies from.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bun "$here/sandbox/build.ts"
