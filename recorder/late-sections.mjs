// Sections counted in each 15-minute window vs the same municipality's 1st round,
// rebuilt from the git history of site/data/r2-mun.json -> site/data/late.json.
// Urnas kept open until 19h (STF order) closed and transmitted last, so they should
// sit in the final windows; the "bound" attributes all extra turnout there to them.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { UF } from '../site/analysis.js';

const git = (...a) => execFileSync('git', a, { maxBuffer: 512e6 }).toString();
const r1 = JSON.parse(readFileSync('site/data/r1.json', 'utf8'));
const C1 = Object.fromEntries(r1.cols.map((c, i) => [c, i + 3]));
const REGS = ['BR', 'N', 'NE', 'CO', 'SE', 'S', 'EX'], REF_END = '20:15';
const shas = git('log', '--reverse', '--format=%H', '--', 'site/data/r2-mun.json').trim().split('\n');
const bins = new Map();     // window start (unix) -> region -> [est, c, c1, L, F, L1]
let prev = null;
for (const sha of shas) {
  const snap = JSON.parse(git('show', `${sha}:site/data/r2-mun.json`));
  const t = Date.parse(snap.updated) / 1000, w = Math.floor(t / 900) * 900;
  if (prev) for (const [k, row] of Object.entries(snap.rows)) {
    const p = prev.rows[k] || [], dEst = row[2] - (p[2] || 0);
    const m = r1.rows[k];
    if (dEst <= 0 || !m) continue;
    const dC = row[4] - (p[4] || 0), dL = row[8] - (p[8] || 0), dF = row[9] - (p[9] || 0);
    const turn1 = m[C1.c] / m[C1.te], two1 = m[C1.v13] / (m[C1.v13] + m[C1.v22] || 1);
    const inc = [dEst, dC, dEst * turn1, dL, dF, (dL + dF) * two1];
    const b = bins.get(w) || Object.fromEntries(REGS.map(r => [r, [0, 0, 0, 0, 0, 0]]));
    for (const rg of ['BR', UF[k.slice(0, 2)].rg]) inc.forEach((v, i) => (b[rg][i] += v));
    bins.set(w, b);
  }
  prev = snap;
}
const ts = [...bins.keys()].sort((a, b) => a - b);
const label = t => new Date((t - 3 * 3600) * 1000).toISOString().slice(11, 16);
const bound = { refUntil: REF_END, byRegion: {}, extra: 0, net: 0 };
for (const rg of REGS.slice(1)) {
  const ref = ts.filter(t => label(t) < REF_END).map(t => bins.get(t)[rg]).reduce((a, b) => a.map((v, i) => v + b[i]), [0, 0, 0, 0, 0, 0]);
  if (!ref[0]) continue;
  const gain = (ref[1] - ref[2]) / ref[0];
  let extra = 0, net = 0;
  for (const t of ts.filter(t => label(t) >= REF_END)) {
    const [est, c, c1, L, F] = bins.get(t)[rg];
    if (!est || !c) continue;
    const e = Math.max(0, (c - c1) / est - gain) * est;
    extra += e; net += e * ((L - F) / c);
  }
  bound.byRegion[rg] = { extra: Math.round(extra), net: Math.round(net), refGain: gain };
  bound.extra += extra; bound.net += net;
}
bound.extra = Math.round(bound.extra); bound.net = Math.round(bound.net);
const regions = Object.fromEntries(REGS.map(rg => [rg, ts.map(t => bins.get(t)[rg].map(Math.round))]));
writeFileSync('site/data/late.json', JSON.stringify({ updated: new Date().toISOString(), cols: ['est', 'c', 'c1', 'L', 'F', 'L1'], t: ts, regions, bound }));
console.log('windows', ts.map(label).join(' '), '| bound', bound.extra, 'voters, net', bound.net);
