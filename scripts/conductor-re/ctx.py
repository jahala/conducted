"""Print regex matches with surrounding context from minified JS.
Usage: python3 -I ctx.py <file> <regex> [before] [after] [max]"""
import re, sys
p, rx = sys.argv[1], sys.argv[2]
b = int(sys.argv[3]) if len(sys.argv) > 3 else 80
a = int(sys.argv[4]) if len(sys.argv) > 4 else 160
mx = int(sys.argv[5]) if len(sys.argv) > 5 else 30
s = open(p, encoding='utf-8', errors='replace').read()
for n, m in enumerate(re.finditer(rx, s)):
    if n >= mx: print('... more'); break
    print(f'@{m.start()}: ' + s[max(0, m.start()-b):m.end()+a].replace('\n', ' '))
    print('---')
