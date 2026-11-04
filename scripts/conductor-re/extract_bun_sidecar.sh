#!/usr/bin/env bash
# Extract the bundled JavaScript from Conductor's Bun-compiled sidecar.
# Bun stores the bundle as plain text in the binary's __BUN,__bun section.
# Usage: extract_bun_sidecar.sh <conductor-runtime binary> <output .js path>
set -euo pipefail

bin="${1:?path to conductor-runtime}"
out="${2:?output .js path}"

# Read the section's file offset and size from the Mach-O load commands.
read -r offset size_hex < <(otool -l "$bin" | awk '
  /sectname __bun$/ { found = 1 }
  found && $1 == "size"   { size = $2 }
  found && $1 == "offset" { print $2, size; exit }')
size=$((size_hex))

[[ -n "${offset:-}" && -n "${size:-}" ]] || { echo "no __bun section in $bin" >&2; exit 1; }

# The bundle starts with "// @bun" and runs until the first NUL byte.
/usr/bin/python3 -I - "$bin" "$offset" "$size" "$out" <<'PY'
import sys
path, offset, size, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
with open(path, "rb") as f:
    f.seek(offset)
    blob = f.read(size)
start = blob.find(b"// @bun")
if start < 0:
    sys.exit("bundle marker '// @bun' not found")
end = blob.find(b"\x00", start)
with open(out, "wb") as f:
    f.write(blob[start:end if end > 0 else len(blob)])
print(f"wrote {out} ({(end - start) if end > 0 else len(blob) - start} bytes)")
PY
