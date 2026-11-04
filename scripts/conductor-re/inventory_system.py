"""System-side inventory of Conductor's extracted code: what the agent process validates, waits for and
reads, and what the Rust shell exposes. Research tool only (decision D002); output stays in .context/.

Usage: python3 -I scripts/conductor-re/inventory_system.py <sidecar.js> <rust binary> <out dir>
Writes TSVs (kind, text, where, context) and a summary of counts.
"""
import os
import re
import subprocess
import sys

sidecar_path, binary_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
sidecar = open(sidecar_path, encoding="utf-8", errors="replace").read()

# Conductor's own code sits in two ranges of the bundle; the rest is bundled libraries (Cursor SDK,
# Claude Agent SDK, Sentry, zod, MCP SDK). Ranges come from native-and-sidecar-map.md B2.
lines = sidecar.split("\n")
OWN = [(1, 60000), (300000, len(lines))]


def own_text():
    for start, end in OWN:
        for number in range(start, min(end, len(lines))):
            yield number + 1, lines[number]


rows = {}


def add(kind, text, where, context):
    bucket = rows.setdefault(kind, {})
    if text not in bucket:
        bucket[text] = (where, context.strip()[:160])


for number, line in own_text():
    where = f"sidecar.js:{number}"
    for m in re.finditer(r'\b(?:process\.env\.|process\.env\[")([A-Z][A-Z0-9_]{2,})', line):
        add("env_var", m.group(1), where, line)
    for m in re.finditer(r'\b([A-Z][A-Za-z0-9]*_?(?:TIMEOUT|DELAY|INTERVAL|LIMIT|MAX|MIN|TTL|MS|BYTES|COUNT)[A-Z0-9_]*)\s*=\s*([0-9][0-9_e.]*)', line):
        add("named_constant", f"{m.group(1)} = {m.group(2)}", where, line)
    for m in re.finditer(r'\b(?:var|let|const)\s+\w+\s*=\s*([1-9][0-9]{3,}|[0-9]+e[0-9]+)\s*[;,]', line):
        add("numeric_constant", m.group(0).strip(" ;,"), where, line)
    for m in re.finditer(r'k\("([a-z][a-z0-9_]+)"\)', line):
        add("schema_literal", m.group(1), where, line)
    for m in re.finditer(r'\b([a-z][A-Za-z0-9]+):\s*(?:A|xn|Ie|Je|D|Ks|Ue|we|k|Ne)\(', line):
        add("schema_field", m.group(1), where, line)
    for m in re.finditer(r'code:\s*"([A-Z_]{4,}|[a-z_]{4,})"', line):
        add("error_code", m.group(1), where, line)
    for m in re.finditer(r'(?:uo|Qe\.(?:info|warn|error)|console\.(?:warn|error))\(\s*[`"]([^`"]{12,160})[`"]', line):
        add("log_message", m.group(1), where, line)

binary = subprocess.run(["strings", "-n", "6", binary_path], capture_output=True, text=True).stdout
for line in binary.split("\n"):
    for m in re.finditer(r'\b([a-z][a-z0-9]+(?:_[a-z0-9]+){1,6})\b', line):
        name = m.group(1)
        if len(name) < 60 and re.match(r'^(pty|fs|shell|sidecar|keychain|notify|notification|speech|updater|search|attachment|image|open|reveal|installed|menu|app|db|log|logs|resource|port|remote|raw|native|check|get|set|start|stop|cancel|ensure|configure|submit|poll|take|prefetch|request|redownload|remove|sync|write|find|list|fuzzy|grep|materialize|upload|resolve|reject|update|quit|crash)_', name):
            add("rust_identifier", name, "conductor binary", line)
    for m in re.finditer(r'\b([a-z-]+://[a-z-]+(?:-[a-z]+)*)\b', line):
        add("rust_event", m.group(1), "conductor binary", line)
    for m in re.finditer(r'(NS[A-Za-z]+UsageDescription|com\.apple\.[a-z.-]+)', line):
        add("macos_permission", m.group(1), "conductor binary", line)

summary = []
for kind, bucket in sorted(rows.items()):
    with open(os.path.join(out, f"{kind}.tsv"), "w", encoding="utf-8") as f:
        f.write("kind\ttext\twhere\tcontext\n")
        for text, (where, context) in sorted(bucket.items()):
            f.write(f"{kind}\t{text}\t{where}\t{context.replace(chr(9), ' ')}\n")
    summary.append(f"{kind}\t{len(bucket)}")
with open(os.path.join(out, "summary.tsv"), "w", encoding="utf-8") as f:
    f.write("kind\tcount\n" + "\n".join(summary) + "\n")
print("\n".join(summary))
