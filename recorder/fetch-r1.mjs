// One-off: first-round presidential result for every municipality (static baseline).
import { readFileSync, writeFileSync } from 'node:fs';
import { R1, uUrl, getJSON, extract, pool, municipalities } from './tse.mjs';

const [cfgPath, outPath] = process.argv.slice(2);
const muns = municipalities(JSON.parse(readFileSync(cfgPath, 'utf8')));
let done = 0, missing = [];
const rows = await pool(muns, 24, async m => {
  const j = await getJSON(uUrl(R1, m.uf, m.cd));
  if (++done % 500 === 0) console.log(done, '/', muns.length);
  if (!j) { missing.push(m.uf + m.cd); return null; }
  return { k: m.uf + m.cd, ...extract(j) };
});
const out = Object.fromEntries(rows.filter(Boolean).map(r => [r.k, r]));
writeFileSync(outPath, JSON.stringify(out));
console.log('saved', Object.keys(out).length, 'missing', missing.length, missing.slice(0, 20));
