import json, math, sys
d = json.load(open('sp/indonesia-province-simple.json'))
PROV = {'DI. ACEH': 'North Sum', 'SUMATERA UTARA': 'North Sum', 'SUMATERA BARAT': 'West Sum', 'RIAU': 'Riau', 'JAMBI': 'Jambi',
        'SUMATERA SELATAN': 'South Sum', 'BANGKA BELITUNG': 'Babel', 'BENGKULU': 'Bengkulu', 'LAMPUNG': 'Lampung', 'KALIMANTAN BARAT': 'West Kal'}
CONTEXT = {'KALIMANTAN TENGAH', 'PROBANTEN', 'DKI JAKARTA', 'JAWA BARAT'}   # tetangga (abu-abu)
def rings(geom):
    if geom['type'] == 'Polygon': return [geom['coordinates'][0]]
    return [p[0] for p in geom['coordinates']]
def area(r):
    return abs(sum(r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1] for i in range(len(r)-1)))/2
def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts)-1):
        p = pts[i]; dd = abs(dy*p[0]-dx*p[1]+b[0]*a[1]-b[1]*a[0])/L
        if dd > dmax: dmax, idx = dd, i
    if dmax > eps: return rdp(pts[:idx+1], eps)[:-1] + rdp(pts[idx:], eps)
    return [a, b]
S = 20  # 1 derajat = 20 unit
def proj(p): return (round(p[0]*S - 95*S, 1), round(-p[1]*S + 7*S, 1))
out = {}; ctx = []
for f in d['features']:
    name = f['properties']['Propinsi']
    rs = rings(f['geometry'])
    if name in PROV or name in CONTEXT:
        big = max(rs, key=area)
        for r in rs:
            a = area(r)
            if a < 0.0006: continue
            key = PROV.get(name)
            if name == 'RIAU' and r is not big:
                cx = sum(p[0] for p in r)/len(r); cy = sum(p[1] for p in r)/len(r)
                if cx > 103.2: key = 'Riau Island'
            eps = 0.02 if a > 0.05 else 0.008
            h = len(r)//2
            simp = rdp(r[:h+1], eps)[:-1] + rdp(r[h:], eps)   # cincin tertutup: sederhanakan per separuh
            if len(simp) < 4: continue
            pts = [proj(p) for p in simp]
            dstr = 'M' + 'L'.join(f'{x:g} {y:g}' for x, y in pts) + 'Z'
            far = key == 'Riau Island' and sum(p[0] for p in r)/len(r) > 106   # Natuna & Anambas: digambar, tidak ikut bingkai zoom
            if key: out.setdefault(key, []).append((dstr, pts, a, far))
            else: ctx.append(dstr)
res = {}
for k, polys in out.items():
    near = [t for t in polys if not t[3]]
    xs = [x for _, pts, _, _ in near for x, _ in pts]; ys = [y for _, pts, _, _ in near for _, y in pts]
    big = max(near, key=lambda t: t[2])[1]
    lx = sum(x for x, _ in big)/len(big); ly = sum(y for _, y in big)/len(big)
    if k == 'Riau Island': lx, ly = (xs and (min(xs)+max(xs))/2), (min(ys)+max(ys))/2
    res[k] = {'d': ''.join(p[0] for p in polys), 'box': [min(xs), min(ys), max(xs), max(ys)], 'label': [round(lx, 1), round(ly, 1)]}
allx = [v['box'][0] for v in res.values()] + [v['box'][2] for v in res.values()]
ally = [v['box'][1] for v in res.values()] + [v['box'][3] for v in res.values()]
print('extent', min(allx), min(ally), max(allx), max(ally), file=sys.stderr)
for k, v in res.items(): print(k, len(v['d']), v['box'], file=sys.stderr)
print('context', sum(len(c) for c in ctx), file=sys.stderr)
ts = ['/* Peta wilayah sell out BNN per daerah (provinsi), dari peta dasar BAKOSURTANAL 1:250.000 (repo superpikar/indonesia-geojson),',
      '   disederhanakan. Koordinat: x = (bujur - 95) x 20, y = (7 - lintang) x 20. Dibuat oleh skrip, jangan disunting manual.',
      '   Kepulauan Riau dipisah dari Riau (data lama masih satu provinsi): pulau di timur 103,2 BT / utara 1,6 LU. */',
      'export interface DaerahShape { d: string; box: [number, number, number, number]; label: [number, number] }',
      'export const DAERAH_SHAPES: Record<string, DaerahShape> = ' + json.dumps(res, separators=(',', ':')) + ';',
      '/** Provinsi tetangga untuk konteks (abu-abu). */',
      'export const CONTEXT_PATH = ' + json.dumps(''.join(ctx)) + ';', '']
open('/home/claude/dashboard_semen_bnn/frontend/src/lib/petaDaerah.ts', 'w').write('\n'.join(ts))
