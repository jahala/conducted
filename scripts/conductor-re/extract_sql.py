"""Dump SQL string/template literals from minified JS bundles.
Usage: python3 -I extract_sql.py <out.txt> <bundle.js>..."""
import re, sys
out = open(sys.argv[1], 'w')
rx = re.compile(r'(["`])(\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|PRAGMA|BEGIN|COMMIT|ROLLBACK|ALTER|DROP)\b(?:\\.|(?!\1).){0,4000})\1', re.S)
for f in sys.argv[2:]:
    s = open(f, encoding='utf-8', errors='replace').read()
    seen = set()
    for m in rx.finditer(s):
        q = re.sub(r'\s+', ' ', m.group(2)).strip()
        if q in seen: continue
        seen.add(q)
        out.write(f'[{f.split("/")[-1]} @{m.start()}] {q}\n\n')
