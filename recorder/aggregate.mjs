// Live round-2 aggregator. Each cycle it reads every state's progress file (-ab),
// re-fetches only municipalities whose count moved, rebuilds the counting timeline
// from the recorder log, writes site/data/*.json and (optionally) pushes to GitHub.
import { readFileSync, writeFileSync, existsSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { R2, uUrl, abUrl, getJSON, extract, pool } from './tse.mjs';

const [cfgPath, snapPath, siteDir, statePath, push] = process.argv.slice(2);
const CYCLE = 40e3, PUSH_EVERY = 100e3;
const UFS = JSON.parse(readFileSync(cfgPath, 'utf8')).abr.map(u => u.cd);
const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { mun: {}, sig: {} };
const series = {};          // uf -> rows [t, st, ts, est, te, c, a, vb, vn, v13, v22]
let snapOffset = 0, lastPush = 0, cycles = 0;

// TSE generation stamps are Brasília time (UTC-3, no DST since 2019).
const brt = (d, h) => { const [D, M, Y] = d.split('/').map(Number); const [hh, mm, ss] = h.split(':').map(Number); return Date.UTC(Y, M - 1, D, hh + 3, mm, ss) / 1000; };

function readNewSnapshots() {
  if (!existsSync(snapPath)) return;
  const fd = openSync(snapPath, 'r');
  const size = fstatSync(fd).size;
  if (size <= snapOffset) return closeSync(fd);
  const buf = Buffer.alloc(size - snapOffset);
  readSync(fd, buf, 0, buf.length, snapOffset);
  closeSync(fd);
  const text = buf.toString('utf8');
  const end = text.lastIndexOf('\n');
  snapOffset += Buffer.byteLength(text.slice(0, end + 1));
  for (const line of text.slice(0, end).split('\n')) {
    if (!line) continue;
    const { uf, d } = JSON.parse(line);
    const r = extract(d);
    const row = [brt(d.dg, d.hg), r.st, r.ts, r.est, r.te, r.c, r.a, r.vb, r.vn, r.cand['13'] || 0, r.cand['22'] || 0];
    const s = (series[uf] ||= []);
    const prev = s[s.length - 1];
    if (prev && prev[1] === row[1] && prev[5] === row[5]) continue;
    // Keep at most one row per UF per minute (the latest), so the file stays small.
    if (prev && Math.floor(prev[0] / 60) === Math.floor(row[0] / 60)) s[s.length - 1] = row; else s.push(row);
  }
}

async function cycle() {
  const t0 = Date.now();
  const abs = await pool(UFS, 8, uf => getJSON(abUrl(R2, uf)).catch(e => (console.error(e.message), null)));
  const todo = [];
  abs.forEach((ab, i) => {
    if (!ab) return;
    for (const m of ab.abr) {
      const key = UFS[i] + m.cdabr, sig = `${m.s.st}|${m.e.c}|${m.and}`;
      if (m.tpabr === 'mun' && Number(m.s.st) > 0 && st.sig[key] !== sig) todo.push([key, UFS[i], m.cdabr, sig]);
    }
  });
  let ok = 0;
  await pool(todo, 24, async ([key, uf, cd, sig]) => {
    try {
      const j = await getJSON(uUrl(R2, uf, cd));
      if (!j) return;
      const r = extract(j), old = st.mun[key];
      const now = Math.floor(Date.now() / 1000);
      st.mun[key] = [r.st, r.ts, r.est, r.te, r.c, r.a, r.vb, r.vn, r.cand['13'] || 0, r.cand['22'] || 0,
        old?.[10] ?? now, r.ts > 0 && r.st >= r.ts ? (old?.[11] || now) : 0];
      st.sig[key] = sig; ok++;
    } catch (e) { console.error(e.message); }
  });
  readNewSnapshots();
  const updated = new Date().toISOString();
  writeFileSync(`${siteDir}/r2-mun.json`, JSON.stringify({ updated, cols: ['st', 'ts', 'est', 'te', 'c', 'a', 'vb', 'vn', 'v13', 'v22', 't0', 't1'], rows: st.mun }));
  writeFileSync(`${siteDir}/timeline.json`, JSON.stringify({ updated, cols: ['t', 'st', 'ts', 'est', 'te', 'c', 'a', 'vb', 'vn', 'v13', 'v22'], series }));
  writeFileSync(statePath, JSON.stringify(st));
  console.log(updated, `cycle ${++cycles}: ${todo.length} changed, ${ok} fetched, ${Object.keys(st.mun).length} muns, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (push === 'push' && Date.now() - lastPush > PUSH_EVERY) {
    try {
      const git = (...a) => execFileSync('git', a, { cwd: siteDir, timeout: 60e3, stdio: 'pipe' }).toString();
      git('add', '-A', '.');
      if (git('status', '--porcelain', '.').trim()) {
        git('commit', '-q', '-m', `data ${updated}`);
        git('push', '-q');
        lastPush = Date.now();
        console.log('  pushed');
      }
    } catch (e) { console.error('push failed', e.message.slice(0, 300)); }
  }
}

for (;;) {
  const t = Date.now();
  await cycle().catch(e => console.error('cycle failed', e));
  await new Promise(r => setTimeout(r, Math.max(5e3, CYCLE - (Date.now() - t))));
}
