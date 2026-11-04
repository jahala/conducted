"""Extract Tauri 2 embedded (brotli) frontend assets from a Mach-O arm64 binary.

Tauri codegen emits phf::Map<&str, &[u8]>; its entries array is a run of
(key_ptr, key_len, val_ptr, val_len) 8-byte words in __DATA_CONST,__const.
Pointers are chained-fixup rebases; low 36 bits hold the target.
Usage: python3 -I extract_tauri_assets.py <binary> <outdir>
"""
import struct, sys, os, site
# -I drops the user site dir, where brotli is installed; add it back explicitly.
sys.path.append(site.getusersitepackages())
import brotli

BASE = 0x100000000

def segments(data):
    ncmds = struct.unpack_from('<I', data, 16)[0]
    off = 32; segs = []
    for _ in range(ncmds):
        cmd, size = struct.unpack_from('<II', data, off)
        if cmd == 0x19:
            name = data[off+8:off+24].rstrip(b'\0').decode()
            vmaddr, vmsize, fileoff, filesize = struct.unpack_from('<QQQQ', data, off+24)
            nsects = struct.unpack_from('<I', data, off+64)[0]
            sects = []
            for i in range(nsects):
                s = off + 72 + i*80
                sn = data[s:s+16].rstrip(b'\0').decode()
                addr, sz = struct.unpack_from('<QQ', data, s+32)
                fo = struct.unpack_from('<I', data, s+48)[0]
                sects.append((sn, addr, sz, fo))
            segs.append((name, vmaddr, vmsize, fileoff, filesize, sects))
        off += size
    return segs

def main(binpath, outdir):
    data = open(binpath, 'rb').read()
    segs = segments(data)
    def v2f(v):
        for name, va, vs, fo, fs, _ in segs:
            if va <= v < va + fs and name != '__PAGEZERO':
                return fo + (v - va)
        return None
    def target(w):
        if w >> 63:  # bind, not a rebase
            return None
        t = w & ((1 << 36) - 1)
        if t < BASE:
            t += BASE
        return t
    const = [s for seg in segs for s in seg[5] if seg[0] == '__DATA_CONST' and s[0] == '__const'][0]
    _, addr, sz, fo = const
    words = struct.unpack_from('<%dQ' % (sz // 8), data, fo)
    entries = []
    i = 0
    while i + 3 < len(words):
        kp, kl, vp, vl = words[i:i+4]
        ok = False
        if 0 < kl < 512 and 0 < vl < 50_000_000:
            kt, vt = target(kp), target(vp)
            kf = v2f(kt) if kt else None
            vf = v2f(vt) if vt else None
            if kf is not None and vf is not None:
                key = data[kf:kf+kl]
                if key.startswith(b'/') and all(32 <= b < 127 for b in key):
                    entries.append((key.decode(), vf, vl))
                    ok = True
        i += 4 if ok else 1
    print('candidate entries:', len(entries))
    seen = set(); written = 0; failed = []
    for key, vf, vl in entries:
        if key in seen:
            continue
        blob = data[vf:vf+vl]
        try:
            out = brotli.decompress(blob)
        except Exception:
            out = None
        if out is None:
            failed.append(key); continue
        seen.add(key)
        rel = os.path.normpath(key.lstrip('/'))
        if rel.startswith('..') or os.path.isabs(rel):
            failed.append(key); continue
        p = os.path.join(outdir, rel)
        os.makedirs(os.path.dirname(p) or outdir, exist_ok=True)
        with open(p, 'wb') as f:
            f.write(out)
        written += 1
    print('written:', written, 'failed:', len(failed))
    for k in failed[:20]:
        print('  fail', k)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
