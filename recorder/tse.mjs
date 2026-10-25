// Shared helpers for reading TSE "unificado" (-u.json) and progress (-ab.json) files.
export const BASE = 'https://resultados.tse.jus.br/oficial/ele2026';
export const R1 = '6257', R2 = '6258';
const pad = (s, n) => String(s).padStart(n, '0');

export const uUrl = (ele, uf, mun = '') =>
  `${BASE}/${ele}/dados/${uf}/${uf}${mun ? pad(mun, 5) : ''}-c0001-e${pad(ele, 6)}-u.json`;
export const abUrl = (ele, uf) => `${BASE}/${ele}/dados/${uf}/${uf}-e${pad(ele, 6)}-ab.json`;

export async function getJSON(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(res => setTimeout(res, 500 * 2 ** i));
    }
  }
}

const num = x => (x === undefined || x === null || x === '' ? 0 : Number(x));

// Compact record: counts only, candidate votes keyed by ballot number.
export function extract(j) {
  const cand = {};
  for (const cg of j.carg || [])
    for (const a of cg.agr || [])
      for (const p of a.par || [])
        for (const c of p.cand || []) cand[c.n] = num(c.vap);
  return {
    hg: j.hg, dg: j.dg, and: j.and,
    ts: num(j.s?.ts), st: num(j.s?.st),
    te: num(j.e?.te), est: num(j.e?.est), c: num(j.e?.c), a: num(j.e?.a),
    vv: num(j.v?.vv), vb: num(j.v?.vb), vn: num(j.v?.tvn),
    cand,
  };
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export function municipalities(cfg) {
  const list = [];
  for (const u of cfg.abr) for (const m of u.mu) list.push({ uf: u.cd, cd: m.cd, nm: m.nm, cdi: m.cdi, cap: m.c === 's' });
  return list;
}
