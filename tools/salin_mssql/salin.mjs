// Menyalin data SEMENTRACK dari PostgreSQL ke SQL Server (database MARKETING_ANALIS).
// Tabel tujuan harus sudah dibuat dengan docs/mssql/01_tabel.sql.
//
// Pakai (di folder ini):   npm install   lalu   node salin.mjs
//   node salin.mjs --cek                 hanya pemeriksaan awal, tidak menulis apa pun
//   node salin.mjs --tabel distributor,target   hanya tabel tertentu
//
// Password diketik saat skrip berjalan (tidak tampil, tidak disimpan di mana pun).
// Isi tabel tujuan yang disalin akan DIGANTI dengan isi dari PostgreSQL.
//
// Cara kerja: tiap baris diambil dari PostgreSQL sebagai JSON (angka desimal dan tanggal sebagai teks,
// jadi tidak ada pembulatan atau geser zona waktu), lalu dimasukkan ke SQL Server lewat OPENJSON
// per 5.000 baris. Satu tabel = satu transaksi: kalau gagal, tabel itu kembali seperti semula.

import pg from 'pg';
import sql from 'mssql';
import readline from 'node:readline';

const BATCH = 5000;
// staging (isi sementara saat upload) dan sesi login tidak perlu dipindah
const LEWATI = new Set(['sementrack.transaksi_staging', 'sementrack.sellin_bnn_staging', 'sementrack.sellin_po_staging', 'auth_local.sessions']);
const PG_SCHEMA = { dbo: 'public', sementrack: 'sementrack', auth_local: 'auth_local' };

const args = process.argv.slice(2);
const HANYA_CEK = args.includes('--cek');
const iTabel = args.indexOf('--tabel');
const PILIH = iTabel >= 0 ? new Set((args[iTabel + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) : null;

// ---------- input ----------
// satu readline untuk semua pertanyaan; saat password, ketikan tidak ditampilkan
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
rl._writeToOutput = function (str) { if (!this.sembunyi) this.output.write(str); };
rl.on('SIGINT', () => { process.stdout.write('\n'); process.exit(1); });
const antre = [], tunggu = [];
rl.on('line', l => (tunggu.length ? tunggu.shift()(l) : antre.push(l)));
rl.on('close', () => { while (tunggu.length) tunggu.shift()(null); });
const baris = () => new Promise(r => (antre.length ? r(antre.shift()) : tunggu.push(r)));
async function tanya(label, bawaan = '') {
  process.stdout.write(`${label}${bawaan ? ` [${bawaan}]` : ''}: `);
  const j = await baris();
  if (j === null) throw new Error('Input berhenti.');
  if (!process.stdin.isTTY) process.stdout.write('\n');
  return j.trim() || bawaan;
}
async function tanyaRahasia(label) {
  process.stdout.write(`${label}: `);
  rl.sembunyi = true;
  const j = await baris();
  rl.sembunyi = false;
  process.stdout.write('\n');
  if (j === null) throw new Error('Input berhenti.');
  return j;
}
const qi = s => `[${s.replace(/]/g, ']]')}]`;            // identifier SQL Server
const qp = s => `"${s.replace(/"/g, '""')}"`;             // identifier PostgreSQL
const angka = n => Number(n).toLocaleString('id-ID');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// ---------- tipe kolom ----------
export function tipeMs(c) {
  const t = c.tipe;
  if (['nvarchar', 'varchar', 'nchar', 'char'].includes(t)) return 'nvarchar(max)'; // dibaca lebar; kalau tidak muat, INSERT yang menolak (tidak terpotong diam-diam)
  if (['decimal', 'numeric'].includes(t)) return `decimal(${c.presisi},${c.skala})`;
  if (['datetimeoffset', 'datetime2', 'time'].includes(t)) return `${t}(${c.skala})`;
  return t;
}
export function exprPg(nama, tipePg) {
  const k = qp(nama);
  if (tipePg === 'timestamp with time zone') return `to_char(${k}, 'YYYY-MM-DD"T"HH24:MI:SS.MSTZH:TZM')`;
  if (tipePg === 'timestamp without time zone') return `to_char(${k}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`;
  if (tipePg === 'date') return `to_char(${k}, 'YYYY-MM-DD')`;
  if (tipePg === 'json' || tipePg === 'jsonb') return `${k}::text`;
  if (tipePg.endsWith('[]')) return `to_json(${k})::text`;                  // array disimpan sebagai teks JSON
  if (/^(numeric|double precision|real|time)/.test(tipePg)) return `${k}::text`;
  return k;                                                                 // teks, bilangan bulat, boolean
}

async function main() {
  console.log('\nSalin data SEMENTRACK: PostgreSQL ke SQL Server');
  console.log(HANYA_CEK ? 'Mode cek: tidak ada data yang ditulis.\n' : '\n');

  console.log('PostgreSQL (sumber)');
  const pgCfg = {
    host: await tanya('  Host', '10.10.20.8'),
    port: Number(await tanya('  Port', '61385')),
    database: await tanya('  Database', 'web_semen'),
    user: await tanya('  User'),
  };
  pgCfg.password = await tanyaRahasia('  Password');

  console.log('\nSQL Server (tujuan)');
  const server = await tanya('  Server (seperti di kotak "Server name" SSMS)', '6MN1134');
  const msDb = await tanya('  Database', 'MARKETING_ANALIS');
  const msUser = await tanya('  Login', 'mktagent');
  const msPass = await tanyaRahasia('  Password');

  // "HOST\INSTANCE" atau "HOST,PORT"
  let host = server, instanceName, port;
  if (server.includes('\\')) [host, instanceName] = server.split('\\');
  else if (server.includes(',')) { [host, port] = server.split(','); port = Number(port); }
  const msCfg = {
    server: host, database: msDb, user: msUser, password: msPass,
    ...(port ? { port } : {}),
    options: { ...(instanceName ? { instanceName } : {}), encrypt: true, trustServerCertificate: true, useUTC: true },
    pool: { max: 1, min: 0 },   // satu koneksi saja: SET IDENTITY_INSERT berlaku per koneksi
    requestTimeout: 10 * 60 * 1000, connectionTimeout: 30000,
  };

  const pgc = new pg.Client({ ...pgCfg, application_name: 'salin_mssql' });
  try { await pgc.connect(); } catch (e) { throw new Error(`Tidak bisa masuk ke PostgreSQL: ${e.message}`); }
  await pgc.query(`set timezone = 'Asia/Jakarta'; set datestyle = 'ISO'`);
  let ms;
  try { ms = await sql.connect(msCfg); } catch (e) { throw new Error(`Tidak bisa masuk ke SQL Server: ${e.message}`); }
  console.log('\nTerhubung ke kedua database.\n');

  // ---------- daftar tabel & kolom tujuan ----------
  const kol = (await ms.request().query(`
    select s.name skema, t.name tabel, c.name kolom, c.column_id urut, ty.name tipe, c.max_length panjang, c.precision presisi, c.scale skala,
           c.is_identity identitas, c.is_computed hitung
    from sys.tables t join sys.schemas s on s.schema_id = t.schema_id
    join sys.columns c on c.object_id = t.object_id join sys.types ty on ty.user_type_id = c.user_type_id
    where s.name in ('dbo','sementrack','auth_local') order by s.name, t.name, c.column_id`)).recordset;
  const unik = (await ms.request().query(`
    select s.name skema, t.name tabel, i.name indeks, c.name kolom, ty.name tipe
    from sys.indexes i join sys.tables t on t.object_id = i.object_id join sys.schemas s on s.schema_id = t.schema_id
    join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id and ic.is_included_column = 0
    join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id join sys.types ty on ty.user_type_id = c.user_type_id
    where i.is_unique = 1 and s.name in ('dbo','sementrack','auth_local') order by i.name, ic.key_ordinal`)).recordset;

  const tabel = new Map();
  for (const c of kol) {
    const k = `${c.skema}.${c.tabel}`;
    if (!tabel.has(k)) tabel.set(k, { ms: k, pg: `${PG_SCHEMA[c.skema]}.${c.tabel}`, skema: c.skema, nama: c.tabel, kolom: [], unik: new Map() });
    if (!c.hitung) tabel.get(k).kolom.push(c);
  }
  for (const u of unik) {
    const t = tabel.get(`${u.skema}.${u.tabel}`);
    if (!t) continue;
    if (!t.unik.has(u.indeks)) t.unik.set(u.indeks, []);
    t.unik.get(u.indeks).push(u);
  }
  if (!tabel.size) throw new Error(`Database ${msDb} belum berisi tabel. Jalankan dulu docs/mssql/01_tabel.sql di SSMS.`);

  // kolom di PostgreSQL
  const pgKol = (await pgc.query(`
    select n.nspname||'.'||c.relname tbl, a.attname kolom, format_type(a.atttypid, a.atttypmod) tipe
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','sementrack','auth_local') and c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped`)).rows;
  const pgMap = new Map();
  for (const r of pgKol) {
    if (!pgMap.has(r.tbl)) pgMap.set(r.tbl, new Map());
    pgMap.get(r.tbl).set(r.kolom.toLowerCase(), r);
  }

  let daftar = [...tabel.values()].filter(t => !LEWATI.has(t.ms));
  if (PILIH) {
    daftar = daftar.filter(t => PILIH.has(t.nama.toLowerCase()) || PILIH.has(t.ms.toLowerCase()));
    if (!daftar.length) throw new Error('Tabel di --tabel tidak ditemukan.');
  }

  // ---------- pemeriksaan awal ----------
  console.log('Pemeriksaan awal');
  const masalah = [];
  for (const t of daftar) {
    const kp = pgMap.get(t.pg);
    if (!kp) { masalah.push(`${t.ms}: tabel tidak ada di PostgreSQL (${t.pg})`); continue; }
    t.pasangan = [];
    for (const c of t.kolom) {
      const p = kp.get(c.kolom.toLowerCase());
      if (!p) { if (c.identitas) continue; masalah.push(`${t.ms}.${c.kolom}: kolom tidak ada di PostgreSQL`); continue; }
      t.pasangan.push({ ms: c, pg: p });
    }
    for (const [nama] of kp) if (!t.kolom.some(c => c.kolom.toLowerCase() === nama)) masalah.push(`${t.ms}: kolom PostgreSQL "${nama}" tidak ada di SQL Server (tidak ikut disalin)`);
    t.identitas = t.pasangan.some(x => x.ms.identitas);
    t.baris = Number((await pgc.query(`select count(*) n from ${qp(PG_SCHEMA[t.skema])}.${qp(t.nama)}`)).rows[0].n);

    // teks yang lebih panjang dari kolom tujuan
    const batas = t.pasangan.filter(x => ['nvarchar', 'varchar', 'nchar', 'char'].includes(x.ms.tipe) && x.ms.panjang > 0);
    if (batas.length && t.baris) {
      const r = (await pgc.query(`select ${batas.map((x, i) => `max(length(${qp(x.pg.kolom)}::text)) k${i}`).join(', ')} from ${qp(PG_SCHEMA[t.skema])}.${qp(t.nama)}`)).rows[0];
      batas.forEach((x, i) => {
        const muat = x.ms.tipe.startsWith('n') ? x.ms.panjang / 2 : x.ms.panjang;
        if (r[`k${i}`] > muat) masalah.push(`${t.ms}.${x.ms.kolom}: data terpanjang ${r[`k${i}`]} karakter, kolom tujuan hanya ${muat}`);
      });
    }
    // kunci unik: SQL Server tidak membedakan huruf besar/kecil, mengabaikan spasi di akhir, dan hanya menerima satu NULL
    for (const [idx, ks] of t.unik) {
      if (!t.baris) continue;
      const ex = ks.map(k => ['nvarchar', 'varchar', 'nchar', 'char'].includes(k.tipe) ? `upper(rtrim(${qp(k.kolom)}))` : qp(k.kolom));
      const r = (await pgc.query(`select count(*) n, min(contoh) contoh from (select ${ex.map((e, i) => `${e} k${i}`).join(', ')},
          concat_ws(' | ', ${ks.map(k => `${qp(k.kolom)}::text`).join(', ')}) contoh
        from ${qp(PG_SCHEMA[t.skema])}.${qp(t.nama)}) x group by ${ex.map((_, i) => `k${i}`).join(', ')} having count(*) > 1`)).rows;
      if (r.length) masalah.push(`${t.ms} (${idx}): ${r.length} nilai kembar menurut aturan SQL Server, contoh "${r[0].contoh}"`);
    }
  }

  const total = daftar.reduce((s, t) => s + (t.baris || 0), 0);
  console.log(`\n  ${pad('Tabel', 42)}${padL('Baris', 10)}`);
  for (const t of daftar) console.log(`  ${pad(t.ms, 42)}${padL(angka(t.baris ?? 0), 10)}`);
  console.log(`  ${pad('Total', 42)}${padL(angka(total), 10)}`);
  console.log(`  (dilewati: ${[...LEWATI].join(', ')})\n`);

  const fatal = masalah.filter(m => !m.includes('tidak ikut disalin'));
  if (masalah.length) {
    console.log('Temuan:');
    for (const m of masalah) console.log(`  - ${m}`);
    console.log('');
  } else console.log('Tidak ada temuan. Data siap disalin.\n');

  if (HANYA_CEK) return;
  if (fatal.length) { console.log('Penyalinan dibatalkan karena temuan di atas. Kirim daftar temuan ini untuk diperbaiki.'); return; }

  const ok = (await tanya(`Isi ${daftar.length} tabel di ${msDb} akan diganti dengan data PostgreSQL. Lanjut? (y/n)`, 'n')).toLowerCase();
  if (ok !== 'y' && ok !== 'ya') { console.log('Dibatalkan.'); return; }

  // ---------- salin ----------
  // relasi dan aturan isian dimatikan dulu supaya urutan tabel bebas; dinyalakan lagi (dan diperiksa ulang) di akhir
  // semua tabel, bukan hanya yang disalin: toko punya relasi ON DELETE CASCADE ke distributor
  for (const t of tabel.values()) await ms.request().query(`alter table ${qi(t.skema)}.${qi(t.nama)} nocheck constraint all`);

  const hasil = [];
  for (const t of daftar) {
    const mulai = Date.now();
    const tujuan = `${qi(t.skema)}.${qi(t.nama)}`;
    const cols = t.pasangan.map(x => x.ms.kolom);
    const insert = `insert into ${tujuan} (${cols.map(qi).join(', ')})
      select ${cols.map(qi).join(', ')} from openjson(@j) with (${t.pasangan.map(x => `${qi(x.ms.kolom)} ${tipeMs(x.ms)} '$."${x.ms.kolom}"'`).join(', ')})`;
    const tx = new sql.Transaction(ms);
    let masuk = 0;
    process.stdout.write(`  ${pad(t.ms, 42)}`);
    try {
      await tx.begin();
      await new sql.Request(tx).query(`delete from ${tujuan}`);
      if (t.identitas) await new sql.Request(tx).query(`set identity_insert ${tujuan} on`);
      await pgc.query('begin read only');
      await pgc.query(`declare c no scroll cursor for select row_to_json(x)::text j from (select ${t.pasangan.map(x => `${exprPg(x.pg.kolom, x.pg.tipe)} as ${qp(x.ms.kolom)}`).join(', ')} from ${qp(PG_SCHEMA[t.skema])}.${qp(t.nama)}) x`);
      for (;;) {
        const r = await pgc.query(`fetch ${BATCH} from c`);
        if (!r.rows.length) break;
        await new sql.Request(tx).input('j', sql.NVarChar(sql.MAX), `[${r.rows.map(x => x.j).join(',')}]`).query(insert);
        masuk += r.rows.length;
        process.stdout.write(`\r  ${pad(t.ms, 42)}${padL(angka(masuk), 10)}`);
      }
      await pgc.query('commit');
      if (t.identitas) await new sql.Request(tx).query(`set identity_insert ${tujuan} off`);
      await tx.commit();
      const n = (await ms.request().query(`select count_big(*) n from ${tujuan}`)).recordset[0].n;
      const cocok = Number(n) === t.baris;
      hasil.push({ t, n: Number(n), cocok });
      console.log(`\r  ${pad(t.ms, 42)}${padL(angka(n), 10)}  ${cocok ? 'cocok' : `BEDA, PostgreSQL ${angka(t.baris)}`}  (${((Date.now() - mulai) / 1000).toFixed(1)} dtk)`);
    } catch (e) {
      try { await pgc.query('rollback'); } catch { /* sudah selesai */ }
      try { await tx.rollback(); } catch { /* transaksi sudah dibatalkan server */ }
      if (t.identitas) try { await ms.request().query(`set identity_insert ${tujuan} off`); } catch { /* sudah mati */ }
      hasil.push({ t, gagal: e.message });
      console.log(`\r  ${pad(t.ms, 42)}GAGAL: ${e.message}`);
    }
  }

  console.log('\nMenyalakan lagi relasi dan aturan isian (sambil memeriksa semua data)...');
  const gagalCek = [];
  for (const t of tabel.values()) {
    try { await ms.request().query(`alter table ${qi(t.skema)}.${qi(t.nama)} with check check constraint all`); }
    catch (e) { gagalCek.push(`${t.ms}: ${e.message}`); }
  }

  const gagal = hasil.filter(h => h.gagal), beda = hasil.filter(h => !h.gagal && !h.cocok);
  console.log('\nRingkasan');
  console.log(`  Tabel berhasil      : ${hasil.length - gagal.length} dari ${hasil.length}`);
  console.log(`  Baris disalin       : ${angka(hasil.reduce((s, h) => s + (h.n || 0), 0))} dari ${angka(total)}`);
  if (beda.length) console.log(`  Jumlah baris beda   : ${beda.map(h => h.t.ms).join(', ')}`);
  if (gagal.length) console.log(`  Gagal               : ${gagal.map(h => h.t.ms).join(', ')}`);
  if (gagalCek.length) { console.log('  Relasi / aturan yang tidak lolos:'); for (const g of gagalCek) console.log(`    - ${g}`); }
  if (!gagal.length && !beda.length && !gagalCek.length) console.log('\nSemua data pindah dan lolos pemeriksaan.');
  else console.log('\nKirim seluruh tulisan di layar ini untuk diperiksa. Tabel yang gagal bisa diulang dengan --tabel nama1,nama2.');

  await pgc.end();
  await ms.close();
}

if (import.meta.url.endsWith('/salin.mjs') && process.argv[1]?.replace(/\\/g, '/').endsWith('salin.mjs'))
  main().then(() => process.exit(0), e => { console.error(`\n${e.message}`); process.exit(1); });
