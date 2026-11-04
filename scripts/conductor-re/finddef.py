"""Find the definition of a minified identifier. Usage: python3 -I finddef.py <chars> <name...>. Names imported by renderApp from main are resolved to main's local name."""
import re,sys,json,os
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.context', 'conductor-re', 'frontend', 'assets', '')
A=ASSETS
M=open(A+'main-BE1h_1MP.js',encoding='utf-8').read()
R=open(A+'renderApp-DeUrsznk.js',encoding='utf-8').read()
exp=M[M.rfind('export{'):]
e2l={}
for loc,ex in re.findall(r'([\w$]+) as ([\w$]+)',exp): e2l[ex]=loc
# exports without 'as'
imp=re.search(r'import\{[^}]*\}from"\./main-BE1h_1MP\.js"',R).group(0)
r2l={}
for ex,al in re.findall(r'([\w$]+) as ([\w$]+)',imp):
    r2l[al]=e2l.get(ex,ex)
def find(S,nm,n):
    e=re.escape(nm)
    for p in [r'(?:async\s+)?function\*?\s+'+e+r'\(', r'class\s+'+e+r'[\s{]', r'(?:const|let|var)\s+'+e+r'=', r'[,;]'+e+r'=(?!=)']:
        m=re.search(p,S)
        if m: return m.start(), S[m.start():m.start()+n].replace('\n',' ')
n=int(sys.argv[1])
for nm in sys.argv[2:]:
    r=find(R,nm,n)
    if r: print(f'## r:{nm} @{r[0]}: {r[1]}'); continue
    loc=r2l.get(nm)
    if loc:
        r=find(M,loc,n)
        if r: print(f'## r:{nm} -> m:{loc} @{r[0]}: {r[1]}'); continue
    r=find(M,nm,n)
    if r: print(f'## m:{nm} @{r[0]}: {r[1]}'); continue
    print('## NOT FOUND',nm, loc)
