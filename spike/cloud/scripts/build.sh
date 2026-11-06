#!/usr/bin/env bash
# CLOUD-02 spike: compiles the sidecar and the bridge for linux-x64 (baseline: no AVX2 needed, so it also runs under local emulation) and copies the git scripts into
# container/build, which the Dockerfile copies into the image. The sidecar source is unchanged; the
# real change would be a "linux-x64" row in SIDECAR_TARGETS (packages/sidecar/src/packaging.ts).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="$here/container/build"
mkdir -p "$out/bin"
(cd "$repo/packages/sidecar" && bun build src/main.ts --compile --target bun-linux-x64-baseline --outfile "$out/conducted-sidecar")
(cd "$here" && bun build container/bridge.ts --compile --target bun-linux-x64-baseline --outfile "$out/bridge")
cp "$repo/bin/checkpointer.sh" "$repo/bin/git-busy-check.sh" "$repo/bin/spotlighter.sh" "$out/bin/"
ls -la "$out" "$out/bin"
