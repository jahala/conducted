#!/usr/bin/env bash
# CLOUD-03: compiles the sidecar and the relay bridge for linux-x64 (the baseline target needs no
# AVX2) and copies the git scripts into container/build, which the Dockerfile copies into the
# sandbox image. The image itself belongs to CLOUD-04; this keeps the CLOUD-02 spike image running
# until CLOUD-04 builds ours.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="$here/container/build"
mkdir -p "$out/bin"
(cd "$repo/packages/sidecar" && bun build src/main.ts --compile --target bun-linux-x64-baseline --outfile "$out/conducted-sidecar")
(cd "$here" && bun build container/bridge.ts --compile --target bun-linux-x64-baseline --outfile "$out/bridge")
cp "$repo/bin/checkpointer.sh" "$repo/bin/git-busy-check.sh" "$repo/bin/spotlighter.sh" "$out/bin/"
ls -la "$out" "$out/bin"
