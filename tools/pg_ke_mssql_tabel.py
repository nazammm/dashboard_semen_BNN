# Membuat docs/mssql/01_tabel.sql (T-SQL, SQL Server 2022) dari katalog PostgreSQL yang sedang dipakai.
# Pakai: python3 tools/pg_ke_mssql_tabel.py "psql -h HOST -p PORT -U USER -d DB -XAt" docs/mssql/01_tabel.sql
# Panjang kolom teks dihitung dari data terpanjang x2 (dibulatkan), supaya kunci tetap di bawah batas indeks SQL Server.
import json, re, subprocess, sys

PSQL, OUT = sys.argv[1], sys.argv[2]
def q(sql):
    r = subprocess.run(PSQL.split() + ['-c', sql], capture_output=True, text=True, check=True)
    return json.loads(r.stdout.strip() or 'null')

TABLES = [  # (schema pg, tabel) yang dipakai web; schema public -> dbo
 ('public','distributor'),('public','produk'),('public','toko'),('public','transaksi'),('public','status_sync'),
 ('public','toko_pegangan_sales'),('public','salesman_status_target'),
 ('sementrack','distributor_target_salesman'),('sementrack','toko_distributor'),('sementrack','subdist_customer'),
 ('sementrack','kelola_log'),('sementrack','transaksi_staging'),('sementrack','target'),('sementrack','tabel_edit'),
 ('sementrack','sellin_bnn_upload'),('sementrack','sellin_bnn'),('sementrack','sellin_bnn_staging'),('sementrack','sellin_region_map'),
 ('sementrack','sellin_po_upload'),('sementrack','sellin_po'),('sementrack','sellin_po_staging'),
 ('sementrack','sellout_bnn_peta'),('sementrack','sellout_dofas'),('sementrack','sellout_erp'),
 ('sementrack','sellout_j073_dist'),('sementrack','sellout_j073_aturan'),('sementrack','sellout_j073'),
 ('auth_local','users'),('auth_local','sessions'),('auth_local','role_pages'),('auth_local','activity_log'),
]
SCH = {'public': 'dbo', 'sementrack': 'sementrack', 'auth_local': 'auth_local'}
names = ','.join(f"'{s}.{t}'" for s, t in TABLES)

cols = q(f"""select json_agg(x order by x.tbl, x.num) from (
  select n.nspname||'.'||c.relname tbl, a.attnum num, a.attname col, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn,
         pg_get_expr(d.adbin, d.adrelid) def, a.attidentity ident, a.attgenerated gen
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname||'.'||c.relname in ({names}) and a.attnum>0 and not a.attisdropped) x""")
cons = q(f"""select json_agg(x) from (
  select n.nspname||'.'||c.relname tbl, con.conname nm, con.contype t, pg_get_constraintdef(con.oid) def,
         (select json_agg(a.attname order by k.o) from unnest(con.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.n) cols
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname||'.'||c.relname in ({names}) and con.contype in ('p','u','f','c')) x""")
idx = q(f"""select json_agg(x) from (
  select n.nspname||'.'||c.relname tbl, ic.relname nm, i.indisunique uq, pg_get_indexdef(i.indexrelid) def, i.indexprs is not null expr,
         (select json_agg(a.attname order by k.o) from unnest(i.indkey::int2[]) with ordinality k(n,o) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.n) cols
  from pg_index i join pg_class c on c.oid=i.indrelid join pg_class ic on ic.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname||'.'||c.relname in ({names}) and not i.indisprimary
    and not exists (select 1 from pg_constraint k where k.conindid=i.indexrelid)) x""") or []

# kolom yang dipakai kunci / indeks: butuh panjang terbatas
keyed = set()
for k in cons:
    if k['t'] in ('p', 'u', 'f'): keyed.update((k['tbl'], c) for c in (k['cols'] or []))
for i in idx:
    if not i['expr']: keyed.update((i['tbl'], c) for c in (i['cols'] or []))

def maxlen(tbl, col):
    r = q(f"select coalesce(max(length({json.dumps(col)}::text)),0) from {tbl.split('.')[0]}.{json.dumps(tbl.split('.')[1])}")
    return int(r or 0)
def nice(n, keyed):
    # kunci/indeks: ruang 2x data terpanjang (min 50, maks 450); kolom lain longgar (min 200) supaya data baru yang lebih panjang tetap muat
    sizes = (50, 100, 200, 450) if keyed else (200, 400, 1000, 4000)
    for s in sizes:
        if n <= s: return f'nvarchar({s})'
    return 'nvarchar(450)' if keyed else 'nvarchar(max)'

def mstype(tbl, c):
    t = c['typ']
    if t == 'text' or t.startswith('character varying'):
        n = maxlen(tbl, c['col'])
        k = (tbl, c['col']) in keyed
        return nice(n * 2 if k else n * 3, k)
    if t == 'text[]': return 'nvarchar(max)'          # disimpan sebagai JSON array: ["a","b"]
    if t == 'jsonb' or t == 'json': return 'nvarchar(max)'
    if t == 'integer': return 'int'
    if t == 'bigint': return 'bigint'
    if t == 'smallint': return 'smallint'
    if t == 'boolean': return 'bit'
    if t == 'date': return 'date'
    if t == 'numeric': return 'decimal(20,6)'
    if t.startswith('numeric('): return t.replace('numeric', 'decimal')
    if t == 'double precision': return 'float'
    if t == 'real': return 'real'
    if t == 'timestamp with time zone': return 'datetimeoffset(3)'
    if t == 'timestamp without time zone': return 'datetime2(3)'
    if t == 'time without time zone': return 'time(0)'
    raise SystemExit(f'tipe belum dipetakan: {tbl}.{c["col"]} {t}')

def msdefault(d, typ):
    if d is None: return None
    if d.startswith('nextval('): return 'IDENTITY'
    if d == 'now()': return 'sysdatetimeoffset()'
    if d in ('true', 'false'): return '1' if d == 'true' else '0'
    if d == "'{}'::text[]": return "N'[]'"
    m = re.fullmatch(r"'(.*)'::(text|character varying|date|numeric)", d)
    if m: return "N'" + m.group(1) + "'"
    if re.fullmatch(r'-?\d+(\.\d+)?', d): return d
    if d == 'CURRENT_DATE': return 'cast(sysdatetimeoffset() as date)'
    if d == 'CURRENT_TIME': return 'cast(sysdatetimeoffset() as time(0))'
    if d.startswith("(now() AT TIME ZONE"): return "cast(switchoffset(sysdatetimeoffset(), '+07:00') as datetime2(3))"
    if d.startswith("((now() AT TIME ZONE") and '::date' in d: return "cast(switchoffset(sysdatetimeoffset(), '+07:00') as date)"
    raise SystemExit(f'default belum dipetakan: {d}')

def mscheck(d):
    s = d[len('CHECK ('):-1] if d.startswith('CHECK (') else d
    s = re.sub(r"::(text|integer|numeric|date)\b", '', s)
    s = re.sub(r"(\(?[a-z0-9_]+\)?) = ANY \(ARRAY\[([^\]]*)\]\)", lambda m: f"{m.group(1)} IN ({m.group(2)})", s)
    s = re.sub(r"(\(?[a-z0-9_]+\)?) <> ALL \(ARRAY\[([^\]]*)\]\)", lambda m: f"{m.group(1)} NOT IN ({m.group(2)})", s)
    s = s.replace('btrim(', 'trim(').replace("IS DISTINCT FROM", "IS DISTINCT FROM")
    s = re.sub(r"cardinality\(([a-z0-9_]+)\) > 0", r"json_value(\1, '$[0]') IS NOT NULL", s)
    s = re.sub(r"\(\(([a-z0-9_]+) IS NULL\) = \(([a-z0-9_]+) IS NULL\)\)", r"((\1 IS NULL AND \2 IS NULL) OR (\1 IS NOT NULL AND \2 IS NOT NULL))", s)
    s = re.sub(r"'([^']*)'", r"N'\1'", s)
    return s

def tname(tbl):
    s, t = tbl.split('.')
    return f'[{SCH[s]}].[{t}]'

out = ['-- =====================================================================',
       '-- SQL Server 2022: struktur tabel dashboard (hasil tools/pg_ke_mssql_tabel.py, jangan disunting manual).',
       '-- Schema: dbo (dulu public), sementrack, auth_local. Jalankan di database MARKETING_ANALIS. Aman dijalankan ulang:',
       '-- tabel yang sudah ada dilewati. Kolom array PostgreSQL disimpan sebagai teks JSON (["a","b"]).',
       '-- =====================================================================',
       "IF SCHEMA_ID(N'sementrack') IS NULL EXEC(N'CREATE SCHEMA sementrack');",
       "IF SCHEMA_ID(N'auth_local') IS NULL EXEC(N'CREATE SCHEMA auth_local');", 'GO', '']
fks = []
for s, t in TABLES:
    tbl = f'{s}.{t}'
    tc = [c for c in cols if c['tbl'] == tbl]
    if not tc and tbl == 'auth_local.sessions':   # dibuat backend saat start; definisi dari SchemaBootstrap.cs
        out.append("""IF OBJECT_ID(N'auth_local.sessions', N'U') IS NULL
CREATE TABLE [auth_local].[sessions] (
  [token] nvarchar(200) NOT NULL CONSTRAINT [PK_sessions] PRIMARY KEY,
  [username] nvarchar(100) NULL, [email] nvarchar(200) NULL, [role] nvarchar(20) NOT NULL, [name] nvarchar(200) NULL,
  [dist_code] nvarchar(50) NULL, [wilayah] nvarchar(100) NULL, [expires_at] bigint NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sessions_username_idx' AND object_id = OBJECT_ID(N'auth_local.sessions'))
  CREATE INDEX [sessions_username_idx] ON [auth_local].[sessions] ([username]);
""")
        continue
    if not tc: raise SystemExit(f'tabel tidak ada: {tbl}')
    lines = []
    for c in tc:
        ty = mstype(tbl, c)
        # kolom generated (mis. sellin_bnn.ton): jadi kolom biasa, diisi procedure saat simpan
        d = None if c.get('gen') == 's' else msdefault(c['def'], c['typ'])
        if c['ident'] in ('a', 'd'): d = 'IDENTITY'
        part = f"  [{c['col']}] {ty}"
        if d == 'IDENTITY': part += ' IDENTITY(1,1)'
        part += ' NOT NULL' if c['nn'] or d == 'IDENTITY' else ' NULL'
        if d and d != 'IDENTITY': part += f" CONSTRAINT [DF_{t}_{c['col']}] DEFAULT ({d})"
        if c['typ'] in ('text[]', 'jsonb', 'json'): part += f" CONSTRAINT [CK_{t}_{c['col']}_json] CHECK ([{c['col']}] IS NULL OR ISJSON([{c['col']}]) = 1)"
        lines.append(part)
    for k in [k for k in cons if k['tbl'] == tbl]:
        cl = ', '.join(f'[{x}]' for x in k['cols'] or [])
        if k['t'] == 'p': lines.append(f"  CONSTRAINT [PK_{t}] PRIMARY KEY NONCLUSTERED ({cl})" if len(k['cols']) > 2 else f"  CONSTRAINT [PK_{t}] PRIMARY KEY ({cl})")
        elif k['t'] == 'u': lines.append(f"  CONSTRAINT [UQ_{k['nm']}] UNIQUE ({cl})")
        elif k['t'] == 'c': lines.append(f"  CONSTRAINT [CK_{k['nm']}] CHECK ({mscheck(k['def'])})")
        elif k['t'] == 'f':
            m = re.match(r'FOREIGN KEY \(([^)]*)\) REFERENCES (?:(\w+)\.)?(\w+)\(([^)]*)\)(.*)', k['def'])
            rs = m.group(2) or 'public'
            fks.append(f"IF OBJECT_ID(N'{SCH[s]}.FK_{k['nm']}', N'F') IS NULL ALTER TABLE {tname(tbl)} ADD CONSTRAINT [FK_{k['nm']}] FOREIGN KEY ({', '.join('['+x.strip()+']' for x in m.group(1).split(','))}) REFERENCES [{SCH[rs]}].[{m.group(3)}] ({', '.join('['+x.strip()+']' for x in m.group(4).split(','))}){' ON DELETE CASCADE' if 'CASCADE' in m.group(5) else ''};")
    out.append(f"IF OBJECT_ID(N'{SCH[s]}.{t}', N'U') IS NULL\nCREATE TABLE {tname(tbl)} (\n" + ',\n'.join(lines) + '\n);\nGO')
    for i in [i for i in idx if i['tbl'] == tbl]:
        if i['expr']:
            # indeks tahun/bulan berbasis ekspresi -> indeks biasa pada kolom tanggal
            if 'do_date' in i['def'] and 'EXTRACT' in i['def']:
                lead = re.search(r'btree \((\w+), \(\(EXTRACT', i['def'])
                cl = f"[{lead.group(1)}], [do_date]" if lead else '[do_date]'
            else: continue   # upper(trim(...)): tidak perlu, collation sudah tidak membedakan huruf besar/kecil
        else: cl = ', '.join(f'[{x}]' for x in i['cols'])
        if 'DESC' in i['def']: cl = cl.replace(']', '] DESC', 1)
        out.append(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'{i['nm']}' AND object_id = OBJECT_ID(N'{SCH[s]}.{t}'))\n  CREATE {'UNIQUE ' if i['uq'] else ''}INDEX [{i['nm']}] ON {tname(tbl)} ({cl});")
    out.append('')
out.append('-- Relasi antar tabel (setelah semua tabel ada)')
out += fks + ['GO', '']
open(OUT, 'w').write('\n'.join(out))
print('ok', len(TABLES), 'tabel')
