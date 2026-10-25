// Builds the static first-round baseline served to the browser (site/data/r1.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { municipalities } from './tse.mjs';

const [cfgPath, r1Path, outPath] = process.argv.slice(2);
const muns = municipalities(JSON.parse(readFileSync(cfgPath, 'utf8')));
const r1 = JSON.parse(readFileSync(r1Path, 'utf8'));
const MAIN = ['13', '22', '70', '14', '55', '30'];
const rows = {}, tot = {};
for (const m of muns) {
  const r = r1[m.uf + m.cd];
  if (!r) continue;
  const main = MAIN.map(n => r.cand[n] || 0);
  const out = Object.entries(r.cand).filter(([n]) => !MAIN.includes(n)).reduce((s, [, v]) => s + v, 0);
  const row = [m.nm, m.cdi, m.cap ? 1 : 0, r.te, r.c, r.a, r.vb, r.vn, ...main, out];
  rows[m.uf + m.cd] = row;
  row.slice(3).forEach((v, i) => (tot[i] = (tot[i] || 0) + v));
}
const cols = ['te', 'c', 'a', 'vb', 'vn', ...MAIN.map(n => 'v' + n), 'vout'];
writeFileSync(outPath, JSON.stringify({ cols, rows }));
console.log('rows', Object.keys(rows).length, Object.fromEntries(cols.map((c, i) => [c, tot[i]])));
