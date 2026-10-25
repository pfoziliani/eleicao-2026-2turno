// Pure data functions for the runoff dashboard (no DOM) - also runnable in Node.

export const UF = {
  ac: { nm: 'Acre', rg: 'N', tz: -5 }, al: { nm: 'Alagoas', rg: 'NE', tz: -3 },
  am: { nm: 'Amazonas', rg: 'N', tz: -4 }, ap: { nm: 'Amapá', rg: 'N', tz: -3 },
  ba: { nm: 'Bahia', rg: 'NE', tz: -3 }, ce: { nm: 'Ceará', rg: 'NE', tz: -3 },
  df: { nm: 'Distrito Federal', rg: 'CO', tz: -3 }, es: { nm: 'Espírito Santo', rg: 'SE', tz: -3 },
  go: { nm: 'Goiás', rg: 'CO', tz: -3 }, ma: { nm: 'Maranhão', rg: 'NE', tz: -3 },
  mg: { nm: 'Minas Gerais', rg: 'SE', tz: -3 }, ms: { nm: 'Mato Grosso do Sul', rg: 'CO', tz: -4 },
  mt: { nm: 'Mato Grosso', rg: 'CO', tz: -4 }, pa: { nm: 'Pará', rg: 'N', tz: -3 },
  pb: { nm: 'Paraíba', rg: 'NE', tz: -3 }, pe: { nm: 'Pernambuco', rg: 'NE', tz: -3 },
  pi: { nm: 'Piauí', rg: 'NE', tz: -3 }, pr: { nm: 'Paraná', rg: 'S', tz: -3 },
  rj: { nm: 'Rio de Janeiro', rg: 'SE', tz: -3 }, rn: { nm: 'Rio Grande do Norte', rg: 'NE', tz: -3 },
  ro: { nm: 'Rondônia', rg: 'N', tz: -4 }, rr: { nm: 'Roraima', rg: 'N', tz: -4 },
  rs: { nm: 'Rio Grande do Sul', rg: 'S', tz: -3 }, sc: { nm: 'Santa Catarina', rg: 'S', tz: -3 },
  se: { nm: 'Sergipe', rg: 'NE', tz: -3 }, sp: { nm: 'São Paulo', rg: 'SE', tz: -3 },
  to: { nm: 'Tocantins', rg: 'N', tz: -3 }, zz: { nm: 'Exterior', rg: 'EX', tz: null },
};
export const UFS = Object.keys(UF);

export const REGIONS = [
  { id: 'N', nm: 'Norte' }, { id: 'NE', nm: 'Nordeste' }, { id: 'CO', nm: 'Centro-Oeste' },
  { id: 'SE', nm: 'Sudeste' }, { id: 'S', nm: 'Sul' }, { id: 'EX', nm: 'Exterior' },
];
REGIONS.forEach(r => (r.ufs = UFS.filter(u => UF[u].rg === r.id)));

// Polls close at 17:00 local time; TSE only publishes after the last close (19:00 BRT).
export const TZ_GROUPS = [
  { id: 'tz3', nm: '17:00 de Brasília', sub: 'UTC−3 · 20 estados + DF', ufs: UFS.filter(u => UF[u].tz === -3) },
  { id: 'tz4', nm: '18:00 de Brasília', sub: 'UTC−4 · AM MT MS RO RR', ufs: UFS.filter(u => UF[u].tz === -4) },
  { id: 'tz5', nm: '19:00 de Brasília', sub: 'UTC−5 · Acre', ufs: ['ac'] },
  { id: 'ex', nm: 'Exterior', sub: '17:00 no horário local', ufs: ['zz'] },
];

// First-round sources and second-round destinations for the transfer model.
export const SOURCES = [
  { id: 'lula', nm: 'Lula', sub: 'PT', cols: ['v13'] },
  { id: 'flavio', nm: 'Flávio Bolsonaro', sub: 'PL', cols: ['v22'] },
  { id: 'cury', nm: 'Augusto Cury', sub: 'Avante', cols: ['v70'] },
  { id: 'renan', nm: 'Renan Santos', sub: 'Missão', cols: ['v14'] },
  { id: 'caiado', nm: 'Ronaldo Caiado', sub: 'PSD', cols: ['v55'] },
  { id: 'others', nm: 'Zema + 6 outros', sub: 'Novo, UP, PSTU, DC, PCB, Democrata, PCO', cols: ['v30', 'vout'] },
  { id: 'bn', nm: 'Branco / nulo', sub: 'no 1º turno', cols: ['vb', 'vn'] },
  { id: 'abst', nm: 'Não votou', sub: 'no 1º turno', cols: ['a'] },
];
export const DESTS = [
  { id: 'lula', nm: 'Lula' }, { id: 'flavio', nm: 'Flávio' },
  { id: 'bn', nm: 'Branco / nulo' }, { id: 'abst', nm: 'Não votou' },
];

export function scopeUfs(scope) {
  if (scope === 'br') return UFS;
  const rg = REGIONS.find(r => r.id === scope);
  return rg ? rg.ufs : [scope];
}

// Sub-areas one level below the scope: regions for Brazil, states for a region.
export function subAreas(scope) {
  if (scope === 'br') return REGIONS.map(r => ({ id: r.id, nm: r.nm, ufs: r.ufs }));
  const rg = REGIONS.find(r => r.id === scope);
  if (rg) return rg.ufs.map(u => ({ id: u, nm: UF[u].nm, ufs: [u] }));
  return [{ id: scope, nm: UF[scope].nm, ufs: [scope] }];
}

export function joinMunicipalities(r1, r2) {
  const out = [];
  for (const [key, row] of Object.entries(r1.rows)) {
    const uf = key.slice(0, 2);
    const m = { key, uf, rg: UF[uf].rg, nm: row[0], cap: row[2] === 1, r1: {} };
    r1.cols.forEach((c, i) => (m.r1[c] = row[3 + i]));
    const q = r2?.rows[key];
    if (q) { m.r2 = {}; r2.cols.forEach((c, i) => (m.r2[c] = q[i])); }
    out.push(m);
  }
  return out;
}

function addR1(acc, r, f) {
  acc.lula += f * r.v13; acc.flavio += f * r.v22; acc.cury += f * r.v70; acc.renan += f * r.v14;
  acc.caiado += f * r.v55; acc.others += f * (r.v30 + r.vout); acc.bn += f * (r.vb + r.vn);
  acc.abst += f * r.a; acc.c += f * r.c; acc.e += f * r.te;
}
const zeroR1 = () => ({ lula: 0, flavio: 0, cury: 0, renan: 0, caiado: 0, others: 0, bn: 0, abst: 0, c: 0, e: 0 });

// Like-for-like: second-round counted votes vs the first round in the same places.
// A partly counted municipality contributes its first-round result pro-rated by the
// share of its electorate already counted (assumes counted sections are typical).
export function compare(muns) {
  const r2 = { lula: 0, flavio: 0, bn: 0, abst: 0, c: 0, e: 0, n: 0, nFull: 0 };
  const r1 = zeroR1(), full = zeroR1();
  for (const m of muns) {
    addR1(full, m.r1, 1);
    const q = m.r2;
    if (!q || !q.est || !m.r1.te) continue;
    addR1(r1, m.r1, Math.min(1, q.est / m.r1.te));
    r2.lula += q.v13; r2.flavio += q.v22; r2.bn += q.vb + q.vn; r2.abst += q.a;
    r2.c += q.c; r2.e += q.est; r2.n++;
    if (q.ts && q.st >= q.ts) r2.nFull++;
  }
  return { r2, r1, full, ...metrics(r2, r1) };
}

export function metrics(r2, r1) {
  const v2 = r2.lula + r2.flavio;
  const v1 = r1.lula + r1.flavio + r1.cury + r1.renan + r1.caiado + r1.others;
  const L2 = v2 ? r2.lula / v2 : NaN, F2 = v2 ? r2.flavio / v2 : NaN;
  const L1 = v1 ? r1.lula / v1 : NaN, F1 = v1 ? r1.flavio / v1 : NaN;
  const L1two = r1.lula + r1.flavio ? r1.lula / (r1.lula + r1.flavio) : NaN;
  return {
    L2, F2, L1, F1, L1two,
    dL: 100 * (L2 - L1), dF: 100 * (F2 - F1),
    swing: 100 * (L2 - L1two), // + = toward Lula, vs the first-round Lula/Flávio split
    turn2: r2.e ? r2.c / r2.e : NaN, turn1: r1.e ? r1.c / r1.e : NaN,
    bn2: r2.c ? r2.bn / r2.c : NaN, bn1: r1.c ? r1.bn / r1.c : NaN,
    gainL: r2.lula - r1.lula, gainF: r2.flavio - r1.flavio,
  };
}

function projSimplex(v) {
  const u = [...v].sort((a, b) => b - a);
  let css = 0, theta = 0;
  for (let j = 0; j < u.length; j++) {
    css += u[j];
    const t = (css - 1) / (j + 1);
    if (u[j] - t > 0) theta = t;
  }
  return v.map(x => Math.max(0, x - theta));
}

// Ecological regression across municipalities: second-round shares of the counted
// electorate = first-round shares × T, with every row of T a probability vector.
// Weighted constrained least squares (FISTA + simplex projection), lightly
// regularised toward a neutral prior so tiny sources stay stable.
const PRIOR = [
  [0.96, 0.01, 0.01, 0.02], [0.01, 0.96, 0.01, 0.02], [0.35, 0.35, 0.15, 0.15], [0.35, 0.35, 0.15, 0.15],
  [0.35, 0.35, 0.15, 0.15], [0.35, 0.35, 0.15, 0.15], [0.15, 0.15, 0.5, 0.2], [0.04, 0.04, 0.02, 0.9],
];
export function fitTransfers(muns, minMuns = 40, fixedT = null) {
  const S = SOURCES.length, D = DESTS.length;
  const A = Array.from({ length: S }, () => new Float64Array(S));
  const B = Array.from({ length: S }, () => new Float64Array(D));
  const tot = new Float64Array(S), out = new Float64Array(D);
  let n = 0;
  for (const m of muns) {
    const q = m.r2, r = m.r1;
    if (!q || !q.est || !q.c || !r.te) continue;
    const x = [r.v13, r.v22, r.v70, r.v14, r.v55, r.v30 + r.vout, r.vb + r.vn, r.a].map(v => v / r.te);
    const y = [q.v13, q.v22, q.vb + q.vn, q.a].map(v => v / q.est);
    const w = q.est;
    for (let i = 0; i < S; i++) {
      tot[i] += x[i] * q.est;
      for (let j = 0; j < S; j++) A[i][j] += w * x[i] * x[j];
      for (let d = 0; d < D; d++) B[i][d] += w * x[i] * y[d];
    }
    for (let d = 0; d < D; d++) out[d] += y[d] * q.est;
    n++;
  }
  if (n < minMuns) return null;
  if (fixedT) {
    const flows = fixedT.map((row, i) => row.map(p => p * tot[i]));
    return { T: fixedT, flows, tot: [...tot], observed: [...out], fitted: DESTS.map((_, d) => flows.reduce((s, r) => s + r[d], 0)), n };
  }
  let tr = 0;
  for (let i = 0; i < S; i++) tr += A[i][i];
  const lam = 1e-3 * tr / S;
  // Largest eigenvalue of A by power iteration -> step size.
  let v = new Float64Array(S).fill(1), lmax = 0;
  for (let k = 0; k < 60; k++) {
    const w = new Float64Array(S);
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) w[i] += A[i][j] * v[j];
    lmax = Math.hypot(...w);
    v = w.map(x => x / (lmax || 1));
  }
  const L = 2 * (lmax + lam) * 1.05;
  let T = PRIOR.map(r => [...r]), Y = T.map(r => [...r]), tk = 1;
  for (let it = 0; it < 1200; it++) {
    const Tn = Y.map((row, i) => {
      const g = row.map((y, d) => {
        let s = 0;
        for (let j = 0; j < S; j++) s += A[i][j] * Y[j][d];
        return 2 * (s - B[i][d]) + 2 * lam * (y - PRIOR[i][d]);
      });
      return projSimplex(row.map((y, d) => y - g[d] / L));
    });
    const tk1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    Y = Tn.map((row, i) => row.map((x, d) => x + ((tk - 1) / tk1) * (x - T[i][d])));
    T = Tn; tk = tk1;
  }
  const flows = T.map((row, i) => row.map(p => p * tot[i]));
  const fitted = DESTS.map((_, d) => flows.reduce((s, r) => s + r[d], 0));
  return { T, flows, tot: [...tot], observed: [...out], fitted, n };
}

// ---- Timeline -------------------------------------------------------------
// series[uf] rows: [t, st, ts, est, te, c, a, vb, vn, v13, v22]  (t = unix seconds)
export function buildGrid(series, step = 60) {
  // Start once every area has been observed: before its first snapshot an area's
  // running total is unknown (not zero), so earlier moments can't be summed.
  let t0 = -Infinity, t1 = -Infinity;
  for (const uf in series) {
    const rows = series[uf];
    if (!rows.length) continue;
    t0 = Math.max(t0, Math.min(...rows.map(r => r[0])));
    t1 = Math.max(t1, ...rows.map(r => r[0]));
  }
  if (!isFinite(t0)) return null;
  const start = Math.floor(t0 / step) * step, end = Math.ceil(t1 / step) * step;
  const times = [];
  for (let t = start; t <= end; t += step) times.push(t);
  const grid = {};
  for (const uf in series) {
    const rows = [...series[uf]].sort((a, b) => a[0] - b[0]);
    let k = -1;
    grid[uf] = times.map(t => { while (k + 1 < rows.length && rows[k + 1][0] <= t) k++; return k >= 0 ? rows[k] : null; });
  }
  return { times, grid, step };
}

export function sumAt(G, ufs, i) {
  const s = { st: 0, ts: 0, est: 0, te: 0, c: 0, L: 0, F: 0, bn: 0 };
  for (const uf of ufs) {
    const r = G.grid[uf]?.[i];
    if (!r) continue;
    s.st += r[1]; s.ts += r[2]; s.est += r[3]; s.te += r[4]; s.c += r[5]; s.bn += r[7] + r[8]; s.L += r[9]; s.F += r[10];
  }
  return s;
}

// Exact additive split of the change in Lula's share between two moments:
// Δshare = Σ_area (ΔLula_area − share_before × Δvalid_area) / valid_after.
export function contributions(G, areas, ufs, binSec = 300) {
  const { times } = G;
  const idx = t => { let lo = 0, hi = times.length - 1, ans = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; };
  const bins = [];
  for (let b = Math.floor(times[0] / binSec) * binSec; b < times[times.length - 1]; b += binSec) {
    const i0 = idx(b), i1 = idx(b + binSec);
    if (i1 <= i0) continue;
    const S0 = sumAt(G, ufs, i0), S1 = sumAt(G, ufs, i1);
    const V0 = S0.L + S0.F, V1 = S1.L + S1.F;
    if (!V1) continue;
    const s0 = V0 ? S0.L / V0 : 0.5;
    const parts = areas.map(a => {
      const a0 = sumAt(G, a.ufs, i0), a1 = sumAt(G, a.ufs, i1);
      const dL = a1.L - a0.L, dF = a1.F - a0.F, dV = dL + dF;
      return { id: a.id, nm: a.nm, dL, dF, dV, pp: (100 * (dL - s0 * dV)) / V1 };
    });
    bins.push({ t0: times[i0], t1: times[i1], parts, pp: parts.reduce((s, p) => s + p.pp, 0), dV: V1 - V0, s1: S1.L / V1, s0 });
  }
  return bins;
}

// ---- Shared fits, transfer rates and the forecast ---------------------------
const xOf = r => [r.v13, r.v22, r.v70, r.v14, r.v55, r.v30 + r.vout, r.vb + r.vn, r.a];

// One pass of fits reused by every view: pooled, per region and per state. Each
// variant maps a municipality to the transfer matrix used for it; states with too
// few counted municipalities borrow their region's fit, regions the pooled one.
export function fitAll(muns) {
  const pooled = fitTransfers(muns, 25);
  if (!pooled) return null;
  const region = {}, state = {};
  for (const rg of REGIONS) region[rg.id] = fitTransfers(muns.filter(m => m.rg === rg.id))?.T;
  for (const uf of UFS) state[uf] = fitTransfers(muns.filter(m => m.uf === uf), 60)?.T;
  return {
    n: pooled.n,
    variants: [
      ['por estado', m => state[m.uf] || region[m.rg] || pooled.T],
      ['por região', m => region[m.rg] || pooled.T],
      ['agrupado', () => pooled.T],
    ],
  };
}

// Transfer rates in the counted areas under one variant.
export function countedFlows(muns, Tof) {
  const S = SOURCES.length, D = DESTS.length;
  const flows = Array.from({ length: S }, () => new Array(D).fill(0)), tot = new Array(S).fill(0);
  let n = 0;
  for (const m of muns) {
    const q = m.r2, r = m.r1;
    if (!q || !q.est || !q.c || !r.te) continue;
    const f = q.est / r.te, T = Tof(m);
    xOf(r).forEach((v, s) => { tot[s] += v * f; T[s].forEach((p, d) => (flows[s][d] += v * f * p)); });
    n++;
  }
  return { T: flows.map((row, i) => row.map(v => (tot[i] ? v / tot[i] : 0))), flows, tot, n };
}

// Estimate = first variant; range = spread across all variants. `fits` are national
// (see fitAll), so any scope - even a one-municipality DF - gets rates.
export function transferRates(muns, fits) {
  const runs = fits.variants.map(([nm, Tof]) => ({ nm, ...countedFlows(muns, Tof) }));
  const main = runs[0];
  if (!main.n) return null;
  const range = main.T.map((row, i) => row.map((_, d) => [Math.min(...runs.map(r => r.T[i][d])), Math.max(...runs.map(r => r.T[i][d]))]));
  return { ...main, range, models: runs.map(r => r.nm), nFit: fits.n };
}

// Forecast bridge: every municipality's 1st-round result is pushed through its
// transfer matrix. Where votes are already counted the model flows are rescaled so
// each destination matches the actual count (the uncounted part of a partly counted
// municipality is assumed to vote like its counted sections).
export function bridge(muns, Tof) {
  const S = SOURCES.length, D = DESTS.length;
  const flows = Array.from({ length: S }, () => new Array(D).fill(0)), r1 = new Array(S).fill(0);
  for (const m of muns) {
    const r = m.r1, q = m.r2;
    if (!r.te) continue;
    const x = xOf(r), T = Tof(m);
    const F = x.map((v, s) => T[s].map(p => v * p));
    x.forEach((v, s) => (r1[s] += v));
    if (q && q.est) {
      const k = Math.max(1, r.te / q.est);
      const actual = [q.v13, q.v22, q.vb + q.vn, q.a].map(v => v * k);
      for (let d = 0; d < D; d++) {
        const model = F.reduce((t, row) => t + row[d], 0);
        if (model > 0) for (let s = 0; s < S; s++) flows[s][d] += (F[s][d] * actual[d]) / model;
        else { const xs = x.reduce((a, b) => a + b, 0) || 1; for (let s = 0; s < S; s++) flows[s][d] += (actual[d] * x[s]) / xs; }
      }
    } else for (let s = 0; s < S; s++) for (let d = 0; d < D; d++) flows[s][d] += F[s][d];
  }
  const total = DESTS.map((_, d) => flows.reduce((t, row) => t + row[d], 0));
  return { flows, r1, total, share: total[0] / (total[0] + total[1]) };
}

export function predict(muns, fits) {
  const runs = fits.variants.map(([nm, Tof]) => ({ nm, ...bridge(muns, Tof) }));
  const shares = runs.map(r => r.share);
  return { main: runs[0], runs, lo: Math.min(...shares), hi: Math.max(...shares) };
}

// ---- Forecast history ------------------------------------------------------
// One point per scope: [predicted Lula share, low, high, Lula share of the raw count,
// share of the electorate counted]. Fits are national and reused for every scope.
export const SCOPES = ['br', ...REGIONS.map(r => r.id), ...UFS.filter(u => u !== 'zz')];
export const FORECAST_COLS = ['t', 'p', 'lo', 'hi', 'raw', 'cnt'];
const r4 = v => Math.round(v * 1e4) / 1e4;
export function forecastPoint(r1, r2) {
  const muns = joinMunicipalities(r1, r2), fits = fitAll(muns), out = {};
  if (!fits) return out;
  for (const sc of SCOPES) {
    const set = new Set(scopeUfs(sc)), ms = muns.filter(m => set.has(m.uf));
    let L = 0, F = 0, est = 0, te = 0;
    for (const m of ms) { te += m.r1.te; if (m.r2?.est) { L += m.r2.v13; F += m.r2.v22; est += m.r2.est; } }
    if (!est || !(L + F)) continue;
    const pr = predict(ms, fits);
    out[sc] = [r4(pr.main.share), r4(pr.lo), r4(pr.hi), r4(L / (L + F)), r4(est / te)];
  }
  return out;
}
