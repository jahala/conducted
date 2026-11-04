"""Inventory of user-facing strings and identifiers in Conductor's extracted bundles.

Research tool only (decision D002): it lists what Conductor shows and names, so coverage checks can
find behaviour our research missed. Its output stays in .context/, which git ignores.

Usage: python3 -I scripts/conductor-re/inventory.py <frontend assets dir> <sidecar.js> <out dir>
Writes one TSV per kind (kind, text, file, offset, context) and a summary of counts.
"""
import os
import re
import sys

assets, sidecar, out = sys.argv[1], sys.argv[2], sys.argv[3]

# Chunks that hold only icons, syntax grammars, diagram renderers or libraries are skipped by size and
# name; the app code lives in main-*.js and renderApp-*.js.
APP_CHUNKS = [f for f in os.listdir(assets) if re.match(r"(main|renderApp)-.*\.js$", f)]

STRING = r'"((?:[^"\\]|\\.){2,160})"'
KINDS = {
    "text": rf"children:{STRING}",
    "aria_label": rf'"?aria-label"?:{STRING}',
    "placeholder": rf"placeholder:{STRING}",
    "title": rf"(?<![A-Za-z])title:{STRING}",
    "label": rf"(?<![A-Za-z])label:{STRING}",
    "description": rf"(?<![A-Za-z])description:{STRING}",
    "tooltip": rf"(?:tooltip|content):{STRING}",
    "toast": rf"\.(?:success|error|info|warning|message)\({STRING}",
    "route": r'(?:path|to):"(/[A-Za-z0-9_$/.:-]*)"',
    "test_id": rf'"data-testid":{STRING}',
}
SIDECAR_KINDS = {
    "log_tag": r'["`]\[([A-Z][A-Za-z0-9]+)\]',
    "tool_name": r'name:\s*"([A-Z][A-Za-z]+)",\s*description:',
    "rpc_method": r'[A-Z_]{3,}:\s*"([a-z][A-Za-z]+)"',
}
# Strings that are code, not words a person reads.
NOISE = re.compile(r"^[a-z0-9_.:/-]+$|^[A-Z0-9_]+$|^\s*$|^[#.@$]|[{}<>]|^https?:")


def words(text):
    return not NOISE.match(text) or " " in text


def scan(path, kinds, keep):
    found = {}
    data = open(path, encoding="utf-8", errors="replace").read()
    name = os.path.basename(path)
    for kind, pattern in kinds.items():
        rows = found.setdefault(kind, {})
        for m in re.finditer(pattern, data):
            text = m.group(1)
            if kind not in ("route", "test_id", "log_tag", "tool_name", "rpc_method") and not keep(text):
                continue
            if text in rows:
                continue
            context = data[max(0, m.start() - 100) : m.start()].replace("\t", " ").replace("\n", " ")
            rows[text] = (name, m.start(), context)
    return found


def write(found, out):
    os.makedirs(out, exist_ok=True)
    summary = []
    for kind, rows in sorted(found.items()):
        with open(os.path.join(out, f"{kind}.tsv"), "w", encoding="utf-8") as f:
            f.write("kind\ttext\tfile\toffset\tcontext\n")
            for text, (name, offset, context) in sorted(rows.items(), key=lambda r: (r[1][0], r[1][1])):
                f.write(f"{kind}\t{text}\t{name}\t{offset}\t{context}\n")
        summary.append(f"{kind}\t{len(rows)}")
    with open(os.path.join(out, "summary.tsv"), "w", encoding="utf-8") as f:
        f.write("kind\tcount\n" + "\n".join(summary) + "\n")
    print("\n".join(summary))


merged = {}
for chunk in APP_CHUNKS:
    for kind, rows in scan(os.path.join(assets, chunk), KINDS, words).items():
        target = merged.setdefault(kind, {})
        for text, value in rows.items():
            target.setdefault(text, value)
for kind, rows in scan(sidecar, SIDECAR_KINDS, words).items():
    merged.setdefault(f"sidecar_{kind}", {}).update(rows)
write(merged, out)
