"""Find a definition in main-*.js only. Usage: python3 -I maindef.py <chars> <name...>"""
import re,sys
import os
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.context', 'conductor-re', 'frontend', 'assets', '')
A=ASSETS
M=open(A+'main-BE1h_1MP.js',encoding='utf-8').read()
n=int(sys.argv[1])
for nm in sys.argv[2:]:
    e=re.escape(nm); hit=None
    for p in [r'(?:async\s+)?function\*?\s+'+e+r'\(', r'class\s+'+e+r'[\s{]', r'(?:const|let|var)\s+'+e+r'=', r'[,;]'+e+r'=(?!=)']:
        m=re.search(p,M)
        if m: hit=m; break
    print('##',nm, f'@{hit.start()}: '+M[hit.start():hit.start()+n].replace('\n',' ') if hit else 'NOT FOUND')
