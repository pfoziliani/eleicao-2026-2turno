// Polls TSE round-2 presidential files (national + every UF + abroad) and appends
// every new generation to an NDJSON log so the counting timeline can be rebuilt.
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados';
const UFS = ['br','ac','al','am','ap','ba','ce','df','es','go','ma','mg','ms','mt','pa','pb','pe','pi','pr','rj','rn','ro','rr','rs','sc','se','sp','to','zz'];
const INTERVAL = Number(process.argv[3] || 20000);
mkdirSync(OUT, { recursive: true });
const last = {};

async function grab(uf) {
  const url = `${BASE}/${uf}/${uf}-c0001-e006258-u.json`;
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`${uf} HTTP ${r.status}`);
  const j = await r.json();
  const key = `${j.idg}|${j.hg}|${j.s?.st}`;
  if (last[uf] === key) return false;
  last[uf] = key;
  appendFileSync(join(OUT, 'snapshots.ndjson'), JSON.stringify({ ft: new Date().toISOString(), uf, d: j }) + '\n');
  writeFileSync(join(OUT, `latest-${uf}.json`), JSON.stringify(j));
  return true;
}

async function tick() {
  const res = await Promise.allSettled(UFS.map(grab));
  const changed = res.filter(r => r.status === 'fulfilled' && r.value).length;
  const errs = res.filter(r => r.status === 'rejected').map(r => r.reason.message);
  console.log(new Date().toISOString(), 'changed', changed, errs.length ? 'errors ' + errs.join(',') : '');
}

await tick();
setInterval(() => tick().catch(e => console.error(e)), INTERVAL);
