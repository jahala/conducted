"""Print a slice of a bundle. Usage: python3 -I slice.py <m|r> <start> <end>   (m=main-*.js, r=renderApp-*.js)"""
import sys
import os
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.context', 'conductor-re', 'frontend', 'assets', '')
f={'m':'main-BE1h_1MP.js','r':'renderApp-DeUrsznk.js'}[sys.argv[1]]
s=open(ASSETS+f,encoding='utf-8').read()
a=int(sys.argv[2]); b=int(sys.argv[3]); print(s[a:b])
