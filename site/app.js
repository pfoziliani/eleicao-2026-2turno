import * as A from './analysis.js';
import { el, h, legend, lineChart, contribChart, mixBars, scatter, dumbbell, swingBar, fmtK, fmtTime, fmtTimeS, showTip, hideTip } from './charts.js';

const TSE = 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados';
const LIVE_EVERY = 30e3, AGG_EVERY = 60e3;
const S = { scope: 'br', r1: null, r2: null, tl: null, live: {}, liveRows: {}, lastLive: 0, lastAgg: 0, sort: { k: 'ts', dir: -1 } };

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const pct = (v, d = 2) => (isFinite(v) ? (100 * v).toFixed(d) + '%' : '–');
const pp = (v, d = 1) => (isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + ' pp' : '–');
const swingTxt = (v, d = 1) => (isFinite(v) ? (v >= 0 ? 'Lula +' : 'Flávio +') + Math.abs(v).toFixed(d) + ' pp' : '–');
const brt = (d, t) => { const [D, M, Y] = d.split('/').map(Number), [hh, mm, ss] = t.split(':').map(Number); return Date.UTC(Y, M - 1, D, hh + 3, mm, ss) / 1000; };
const num = x => (x == null || x === '' ? 0 : Number(x));
const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd']);
const title = s => s.toLowerCase().replace(/(^|[\s'-])(\p{L}+)/gu, (m, p, w) => p + (SMALL.has(w) && p ? w : w[0].toUpperCase() + w.slice(1)));

function extract(j) {
  const cand = {};
  for (const cg of j.carg || []) for (const a of cg.agr || []) for (const p of a.par || []) for (const c of p.cand || []) cand[c.n] = num(c.vap);
  return { t: brt(j.dg, j.hg), ht: j.ht, dt: j.dt, st: num(j.s?.st), ts: num(j.s?.ts), est: num(j.e?.est), te: num(j.e?.te), c: num(j.e?.c), a: num(j.e?.a), vb: num(j.v?.vb), vn: num(j.v?.tvn), L: cand['13'] || 0, F: cand['22'] || 0 };
}
const toRow = x => [x.t, x.st, x.ts, x.est, x.te, x.c, x.a, x.vb, x.vn, x.L, x.F];

// ---------- data loading ----------
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

async function loadLive() {
  const ufs = ['br', ...A.UFS];
  const res = await Promise.allSettled(ufs.map(uf => getJSON(`${TSE}/${uf}/${uf}-c0001-e006258-u.json`)));
  let ok = 0;
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    ok++;
    const uf = ufs[i], x = extract(r.value);
    S.live[uf] = x;
    if (uf === 'br') return;
    const rows = (S.liveRows[uf] ||= []);
    if (!rows.length || rows[rows.length - 1][0] < x.t) rows.push(toRow(x));
  });
  if (ok) S.lastLive = Date.now();
  return ok;
}

async function loadAgg() {
  const q = '?t=' + Date.now();
  const [r2, tl] = await Promise.allSettled([getJSON('data/r2-mun.json' + q), getJSON('data/timeline.json' + q)]);
  if (r2.status === 'fulfilled') { S.r2 = r2.value; S.muns = A.joinMunicipalities(S.r1, S.r2); }
  if (tl.status === 'fulfilled') S.tl = tl.value;
  S.lastAgg = Date.now();
}

function mergedSeries() {
  const out = {};
  for (const uf of A.UFS) {
    const base = S.tl?.series?.[uf] || [];
    const lastT = base.length ? base[base.length - 1][0] : 0;
    out[uf] = [...base, ...(S.liveRows[uf] || []).filter(r => r[0] > lastT)];
  }
  return out;
}

// Latest per-state totals: live TSE if we have it, else the recorder's last snapshot.
function stateNow(uf) {
  if (S.live[uf]) return S.live[uf];
  const r = S.tl?.series?.[uf]?.at(-1);
  return r && { t: r[0], st: r[1], ts: r[2], est: r[3], te: r[4], c: r[5], a: r[6], vb: r[7], vn: r[8], L: r[9], F: r[10] };
}
function sumStates(ufs) {
  const s = { st: 0, ts: 0, est: 0, te: 0, c: 0, a: 0, vb: 0, vn: 0, L: 0, F: 0, t: 0 };
  for (const uf of ufs) { const x = stateNow(uf); if (!x) continue; for (const k in s) s[k] = k === 't' ? Math.max(s.t, x.t) : s[k] + x[k]; }
  return s;
}

// ---------- areas & colours ----------
const REGION_COLOR = { N: '--r-N', NE: '--r-NE', CO: '--r-CO', SE: '--r-SE', S: '--r-S', EX: '--r-EX' };
function areasFor(scope) {
  if (scope === 'br') return A.REGIONS.map(r => ({ id: r.id, nm: r.nm, ufs: r.ufs, color: REGION_COLOR[r.id] }));
  const rg = A.REGIONS.find(r => r.id === scope);
  if (rg) {
    // Fixed colour per state (by electorate rank within the region); a 7th+ state folds into "Other".
    const ranked = [...rg.ufs].sort((a, b) => (S.r1Tot?.[b] || 0) - (S.r1Tot?.[a] || 0));
    const top = ranked.slice(0, ranked.length > 6 ? 5 : 6), rest = ranked.filter(u => !top.includes(u));
    const out = [...rg.ufs].filter(u => top.includes(u)).map(u => ({ id: u, nm: A.UF[u].nm, ufs: [u], color: '--c' + (top.indexOf(u) + 1) }));
    if (rest.length) out.push({ id: 'other', nm: 'Other: ' + rest.map(u => u.toUpperCase()).join(', '), ufs: rest, color: '--c-other' });
    return out;
  }
  return [{ id: scope, nm: A.UF[scope].nm, ufs: [scope], color: '--c1' }];
}
const scopeName = s => (s === 'br' ? 'Brazil' : A.REGIONS.find(r => r.id === s)?.nm || A.UF[s].nm);
const scopeMuns = s => { const set = new Set(A.scopeUfs(s)); return (S.muns || []).filter(m => set.has(m.uf)); };

// ---------- rendering ----------
function renderStatus() {
  const br = S.live.br;
  const age = S.lastLive ? Math.round((Date.now() - S.lastLive) / 1000) : null;
  const next = S.lastLive ? Math.max(0, Math.round((S.lastLive + LIVE_EVERY - Date.now()) / 1000)) : 0;
  $('liveDot').classList.toggle('on', age != null && age < 90);
  $('status').textContent = br ? `TSE ${fmtTimeS(br.t)} BRT · refreshed ${age}s ago · next in ${next}s` : S.lastAgg ? 'TSE unreachable from this browser · showing recorder data' : 'Connecting to TSE…';
}

function renderHero() {
  const x = S.live.br || sumStates(A.UFS);
  if (!x || !x.L) return;
  const V = x.L + x.F, l = x.L / V, f = x.F / V, lead = x.L - x.F;
  $('hLula').textContent = pct(l);
  $('hFlavio').textContent = pct(f);
  $('hLulaV').textContent = nf.format(x.L) + ' votes';
  $('hFlavioV').textContent = nf.format(x.F) + ' votes';
  $('hLead').textContent = `${lead >= 0 ? 'Lula' : 'Flávio'} leads by ${nf.format(Math.abs(lead))} votes`;
  $('hCounted').textContent = `${pct(x.st / x.ts)} of polling sections counted (${nf.format(x.st)} of ${nf.format(x.ts)})`;
  $('splitL').style.width = `calc(${100 * l}% - 1px)`;
  $('splitF').style.width = `calc(${100 * f}% - 1px)`;
  $('meterFill').style.width = (100 * x.st) / x.ts + '%';
  $('split').setAttribute('aria-label', `Lula ${pct(l)}, Flávio Bolsonaro ${pct(f)} of valid votes`);
  $('heroFoot').textContent = `Turnout in counted sections ${pct(x.c / x.est, 1)} · blank ${pct(x.vb / x.c, 1)} · null ${pct(x.vn / x.c, 1)} of votes cast · 1st round final: Flávio 47.03%, Lula 45.16%, Cury 2.89%, Renan Santos 2.24%, Caiado 2.18%, others 0.48%`;
}

function renderScopeControls() {
  const box = $('scopeBtns');
  if (!box.childElementCount) {
    for (const [id, nm] of [['br', 'Brazil'], ...A.REGIONS.map(r => [r.id, r.nm])]) {
      const b = h('button', { type: 'button', role: 'radio', 'data-id': id }, box, nm);
      b.addEventListener('click', () => setScope(id));
    }
    const sel = $('scopeState');
    h('option', { value: '' }, sel, 'State…');
    for (const uf of A.UFS.filter(u => u !== 'zz').sort((a, b) => A.UF[a].nm.localeCompare(A.UF[b].nm))) h('option', { value: uf }, sel, A.UF[uf].nm);
    sel.addEventListener('change', () => sel.value && setScope(sel.value));
  }
  for (const b of box.children) b.setAttribute('aria-checked', String(b.dataset.id === S.scope));
  $('scopeState').value = A.UF[S.scope] && S.scope !== 'zz' ? S.scope : '';
}

function setScope(s) {
  S.scope = s;
  history.replaceState(null, '', s === 'br' ? location.pathname : '#' + s);
  renderScoped();
}

function tile(host, label, value, delta, keyColor) {
  const t = h('div', { class: 'tile' }, host);
  const l = h('div', { class: 'label' }, t);
  if (keyColor) h('span', { class: 'key' }, l).style.background = `var(${keyColor})`;
  l.appendChild(document.createTextNode(label));
  h('div', { class: 'value' }, t, value);
  const d = h('div', { class: 'delta' }, t);
  for (const part of delta) typeof part === 'string' ? d.appendChild(document.createTextNode(part)) : h('b', {}, d, part.b);
}

function renderTiles(cmp) {
  const host = $('tiles');
  host.replaceChildren();
  if (!cmp.r2.n) { h('p', { class: 'note' }, host, 'No municipalities counted yet in this scope.'); return; }
  tile(host, 'Lula · same areas as 1st round', pct(cmp.L2, 1), [{ b: pp(cmp.dL) }, ` from ${pct(cmp.L1, 1)} on 4 Oct`], '--lula');
  tile(host, 'Flávio · same areas as 1st round', pct(cmp.F2, 1), [{ b: pp(cmp.dF) }, ` from ${pct(cmp.F1, 1)} on 4 Oct`], '--flavio');
  tile(host, 'Net swing vs 1st-round Lula/Flávio split', swingTxt(cmp.swing), [`Lula had ${pct(cmp.L1two, 1)} of the two-man vote on 4 Oct`]);
  tile(host, 'Turnout · same areas', pct(cmp.turn2, 1), [{ b: pp(100 * (cmp.turn2 - cmp.turn1)) }, ` vs ${pct(cmp.turn1, 1)} on 4 Oct`]);
  tile(host, 'Blank + null · same areas', pct(cmp.bn2, 1), [{ b: pp(100 * (cmp.bn2 - cmp.bn1)) }, ` vs ${pct(cmp.bn1, 1)} of votes cast`]);
  $('scopeNote').textContent = `${scopeName(S.scope)} · ${nf.format(cmp.r2.n)} municipalities with votes counted (${nf.format(cmp.r2.nFull)} complete) · data as of ${S.r2 ? fmtTime(Date.parse(S.r2.updated) / 1000) : '–'} BRT`;
}

function renderCompare() {
  const tb = $('cmpTable');
  tb.replaceChildren();
  const head = h('tr', {}, h('thead', {}, tb));
  for (const [t, c] of [['Area', ''], ['Counted', 'num'], ['Lula: 1st → 2nd', ''], ['Lula', 'num'], ['Δ', 'num'], ['Flávio: 1st → 2nd', ''], ['Flávio', 'num'], ['Δ', 'num'], ['Net swing', ''], ['', 'num'], ['Turnout Δ', 'num']]) h('th', { class: c }, head, t);
  const body = h('tbody', {}, tb);
  const isState = A.UF[S.scope];
  let rows;
  if (isState) {
    const ms = scopeMuns(S.scope).filter(m => m.r2?.est).sort((a, b) => b.r1.te - a.r1.te).slice(0, 15);
    rows = ms.map(m => ({ id: m.key, nm: title(m.nm), color: null, muns: [m], counted: m.r2.st / m.r2.ts }));
  } else {
    rows = areasFor(S.scope).map(a => {
      const st = sumStates(a.ufs);
      return { id: a.id, nm: a.nm, color: a.color, muns: (S.muns || []).filter(m => a.ufs.includes(m.uf)), counted: st.ts ? st.st / st.ts : NaN, click: a.id === 'other' ? null : a.id };
    });
  }
  const tot = sumStates(A.scopeUfs(S.scope));
  rows.push({ id: 'all', nm: isState ? `${A.UF[S.scope].nm} (all counted)` : `All ${scopeName(S.scope)}`, muns: scopeMuns(S.scope), counted: tot.ts ? tot.st / tot.ts : NaN, total: true });
  for (const r of rows) {
    const c = A.compare(r.muns);
    const tr = h('tr', { class: r.click ? 'clickable' : '' }, body);
    if (r.total) tr.style.fontWeight = '600';
    if (r.click) tr.addEventListener('click', () => setScope(r.click));
    const name = h('td', { class: 'name' }, tr);
    if (r.color) h('span', { class: 'swatch' }, name).style.background = `var(${r.color})`;
    name.appendChild(document.createTextNode(r.nm));
    h('td', { class: 'num' }, tr, pct(r.counted, 1));
    if (!c.r2.n) { h('td', { colspan: 9, class: 'muted' }, tr, 'not counted yet'); continue; }
    h('td', {}, tr).appendChild(dumbbell(100 * c.L1, 100 * c.L2, '--lula'));
    h('td', { class: 'num' }, tr, pct(c.L2, 1));
    h('td', { class: 'num' }, tr, pp(c.dL));
    h('td', {}, tr).appendChild(dumbbell(100 * c.F1, 100 * c.F2, '--flavio'));
    h('td', { class: 'num' }, tr, pct(c.F2, 1));
    h('td', { class: 'num' }, tr, pp(c.dF));
    h('td', {}, tr).appendChild(swingBar(c.swing));
    h('td', { class: 'num' }, tr, swingTxt(c.swing));
    h('td', { class: 'num' }, tr, pp(100 * (c.turn2 - c.turn1)));
  }
}

const DEST_CLASS = ['lula', 'flavio', 'bn', 'abst'];
const DEST_COLOR = ['--lula', '--flavio', '--bn', '--abst'];
function renderTransfers() {
  const ms = scopeMuns(S.scope);
  const fit = S.scope === 'br' ? A.fitTransfersByRegion(ms) : A.fitTransfers(ms, 25);
  legend($('trLegend'), A.DESTS.map((d, i) => ({ nm: d.nm + ' (2nd round)', color: DEST_COLOR[i] })));
  const host = $('trBars');
  host.replaceChildren();
  if (!fit) { h('p', { class: 'note' }, host, 'Not enough municipalities counted in this scope yet (needs 25+).'); $('trSummary').replaceChildren(); return; }
  $('trDesc').textContent = `How each group of 4 Oct voters appears to be splitting on 25 Oct, estimated from ${nf.format(fit.n)} counted municipalities in ${scopeName(S.scope)}${S.scope === 'br' ? ' (fit region by region)' : ''}. Ecological estimate: it infers aggregate flows from how results moved place by place; treat it as indicative.`;
  const order = [2, 3, 4, 5, 6, 7, 0, 1];
  order.forEach((i, k) => {
    if (k === 6) h('div', { class: 'tr-sep' }, host);
    const src = A.SOURCES[i];
    const nm = h('div', { class: 'tr-name' }, host, src.nm);
    h('small', {}, nm, src.sub);
    const bar = h('div', { class: 'tr-bar' }, host);
    fit.T[i].forEach((p, d) => {
      if (p < 0.0005) return;
      const seg = h('div', { class: DEST_CLASS[d] }, bar);
      seg.style.width = `calc(${100 * p}% - 2px)`;
      if (p >= 0.09) seg.textContent = Math.round(100 * p) + '%';
      seg.addEventListener('pointermove', ev => showTip(ev, `${src.nm} 1st-round voters → ${A.DESTS[d].nm}`, [{ k: 'Share', v: (100 * p).toFixed(1) + '%', color: DEST_COLOR[d] }, { k: 'Votes (est.)', v: '≈ ' + fmtK(fit.flows[i][d]) }]));
      seg.addEventListener('pointerleave', hideTip);
    });
    h('div', { class: 'tr-votes' }, host, `${fmtK(fit.tot[i])} on 4 Oct`);
  });
  // Where each finalist's net gain came from.
  const sum = $('trSummary');
  sum.replaceChildren();
  [[0, 'Lula', '--lula'], [1, 'Flávio', '--flavio']].forEach(([d, nm, color]) => {
    const box = h('div', { class: 'box' }, sum);
    const t = h('h3', {}, box);
    h('span', { class: 'key' }, t).style.background = `var(${color})`;
    t.appendChild(document.createTextNode(`${nm}: where the extra votes come from`));
    const before = fit.tot[d], after = fit.observed[d];
    const p = h('p', {}, box);
    p.style.margin = '0 0 6px';
    p.append(`In these areas: ${fmtK(before)} on 4 Oct → `);
    h('b', {}, p, fmtK(after));
    p.append(` now (${after >= before ? '+' : '−'}${fmtK(Math.abs(after - before))}).`);
    const ul = h('div', {}, box);
    const parts = A.SOURCES.map((s, i) => ({ nm: s.nm, v: i === d ? 0 : fit.flows[i][d] })).filter(x => x.v > 500).sort((a, b) => b.v - a.v);
    const lost = fit.tot[d] - fit.flows[d][d];
    ul.textContent = 'Estimated inflows: ' + parts.map(x => `${x.nm} +${fmtK(x.v)}`).join(' · ') + ` · minus ≈${fmtK(lost)} of his own 1st-round voters who switched, spoiled or stayed home.`;
  });
}

function renderTimeline() {
  const series = mergedSeries();
  const G = A.buildGrid(series);
  if (!G) return;
  const ufs = A.scopeUfs(S.scope), areas = areasFor(S.scope);
  const sums = G.times.map((_, i) => A.sumAt(G, ufs, i));
  const valid = sums.map((s, i) => [G.times[i], s]).filter(([, s]) => s.L + s.F > 0);
  $('tlDesc').textContent = `${scopeName(S.scope)} · Brasília time · TSE files snapshotted every 20 s since ${fmtTime(G.times[0])} BRT (results were first published at 19:00, so the first ~30 min were not recorded).`;
  legend($('lgShare'), [{ nm: 'Lula', color: '--lula', line: true }, { nm: 'Flávio Bolsonaro', color: '--flavio', line: true }]);
  const shL = valid.map(([t, s]) => [t, (100 * s.L) / (s.L + s.F)]), shF = valid.map(([t, s]) => [t, (100 * s.F) / (s.L + s.F)]);
  const all = [...shL, ...shF].map(p => p[1]);
  const lo = Math.min(45, Math.floor(Math.min(...all) - 1)), hi = Math.max(55, Math.ceil(Math.max(...all) + 1));
  lineChart($('chShare'), {
    series: [{ id: 'l', nm: 'Lula', color: '--lula', pts: shL }, { id: 'f', nm: 'Flávio', color: '--flavio', pts: shF }],
    y0: lo, y1: hi, yFmt: v => v.toFixed(0) + '%', tipFmt: v => v.toFixed(2) + '%', refs: [{ v: 50 }],
    tipExtra: t => { const i = G.times.indexOf(t), s = sums[i]; return s ? `${(100 * s.st / s.ts).toFixed(1)}% of sections counted` : ''; },
  });
  legend($('lgProg'), [...areas.map(a => ({ nm: a.nm, color: a.color, line: true })), ...(areas.length > 1 ? [{ nm: 'All', color: '--muted', line: true }] : [])]);
  const prog = areas.map(a => ({ id: a.id, nm: a.nm, color: a.color, pts: G.times.map((t, i) => { const s = A.sumAt(G, a.ufs, i); return [t, s.ts ? (100 * s.st) / s.ts : 0]; }) }));
  if (areas.length > 1) prog.push({ id: 'all', nm: 'All', color: '--muted', pts: G.times.map((t, i) => [t, sums[i].ts ? (100 * sums[i].st) / sums[i].ts : 0]) });
  lineChart($('chProg'), { series: prog, y0: 0, y1: 100, yFmt: v => v.toFixed(0) + '%', tipFmt: v => v.toFixed(1) + '%', endLabels: false });

  const bins = A.contributions(G, areas, ufs, 300);
  legend($('lgContrib'), areas.map(a => ({ nm: a.nm, color: a.color })));
  contribChart($('chContrib'), { bins, areas });
  const co = $('contribCallout');
  co.replaceChildren();
  if (bins.length) {
    const tEnd = bins[bins.length - 1].t1, recent = bins.filter(b => b.t0 >= tEnd - 1800);
    const tot = (bs, id) => bs.reduce((s, b) => s + (b.parts.find(p => p.id === id)?.pp || 0), 0);
    const rank = bs => areas.map(a => ({ a, v: tot(bs, a.id) })).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const r30 = rank(recent), rAll = rank(bins);
    const phrase = r => `${r.a.nm} ${r.v >= 0 ? 'pushed Lula up' : 'pushed toward Flávio'} ${Math.abs(r.v).toFixed(2)} pp`;
    co.append('Last 30 min: ');
    h('b', {}, co, phrase(r30[0]));
    if (r30[1]) co.append('; ' + phrase(r30[1]) + '. ');
    co.append(`Since ${fmtTime(bins[0].t0)}: `);
    h('b', {}, co, phrase(rAll[0]));
    if (rAll[1]) co.append('; ' + phrase(rAll[1]) + '.');
  }

  // Composition: counted votes vs electorate, by area.
  const last = G.times.length - 1;
  const cnt = areas.map(a => { const s = A.sumAt(G, a.ufs, last); return s.L + s.F; });
  const elec = areas.map(a => A.sumAt(G, a.ufs, last).te);
  mixBars($('chMix'), { rows: [{ nm: 'Votes counted', vals: cnt, unit: 'Valid votes counted' }, { nm: 'Electorate', vals: elec, unit: 'Registered voters' }], areas });
  const tc = cnt.reduce((s, v) => s + v, 0), te = elec.reduce((s, v) => s + v, 0);
  const gaps = areas.map((a, i) => ({ a, g: cnt[i] / tc - elec[i] / te })).sort((x, y) => x.g - y.g);
  const under = gaps[0], over = gaps[gaps.length - 1];
  $('mixNote').textContent = tc ? `${under.a.nm} is ${pct(elec[areas.indexOf(under.a)] / te, 0)} of the electorate but only ${pct(cnt[areas.indexOf(under.a)] / tc, 0)} of votes counted so far; ${over.a.nm} is over-represented (${pct(cnt[areas.indexOf(over.a)] / tc, 0)} vs ${pct(elec[areas.indexOf(over.a)] / te, 0)}). The remaining count will shift the total toward how ${under.a.nm} votes.` : '';

  // Poll-closing (time zone) groups.
  const tz = $('tzTable');
  tz.replaceChildren();
  const hr = h('tr', {}, h('thead', {}, tz));
  for (const [t, c] of [['Polls closed', ''], ['Counted', 'num'], ['Lula', 'num'], ['Flávio', 'num'], ['Swing vs 1st', 'num']]) h('th', { class: c }, hr, t);
  const tb = h('tbody', {}, tz);
  for (const g of A.TZ_GROUPS) {
    const s = sumStates(g.ufs), c = A.compare((S.muns || []).filter(m => g.ufs.includes(m.uf)));
    const tr = h('tr', {}, tb);
    const nmTd = h('td', { class: 'name' }, tr, g.nm + ' ');
    h('span', { class: 'muted' }, nmTd, g.sub);
    h('td', { class: 'num' }, tr, pct(s.ts ? s.st / s.ts : NaN, 1));
    h('td', { class: 'num' }, tr, pct(s.L / (s.L + s.F), 1));
    h('td', { class: 'num' }, tr, pct(s.F / (s.L + s.F), 1));
    h('td', { class: 'num' }, tr, swingTxt(c.swing));
  }
}

function renderMunicipalities() {
  const ms = scopeMuns(S.scope).filter(m => m.r2?.est && m.r2.v13 + m.r2.v22 > 0);
  legend($('lgMun'), [{ nm: 'Lula ahead', color: '--lula' }, { nm: 'Flávio ahead', color: '--flavio' }]);
  const pts = ms.map(m => ({
    nm: title(m.nm), uf: m.uf, e: m.r1.te, pct: (100 * m.r2.est) / m.r1.te,
    x: (100 * m.r1.v13) / (m.r1.v13 + m.r1.v22 || 1), y: (100 * m.r2.v13) / (m.r2.v13 + m.r2.v22),
  }));
  scatter($('chMun'), { points: pts });
  const big = pts.filter(p => p.e >= 20000 && p.pct >= 50).map(p => ({ ...p, sw: p.y - p.x }));
  const fill = (id, list, nm, color) => {
    const ol = $(id);
    ol.replaceChildren();
    const hd = h('li', { class: 'head' }, ol);
    h('span', { class: 'key' }, hd).style.background = `var(${color})`;
    hd.append(`Toward ${nm}`);
    if (!list.length) h('li', { class: 'muted' }, ol, '–');
    for (const p of list) {
      const li = h('li', {}, ol);
      const n = h('span', { class: 'nm' }, li, p.nm + ' ');
      h('small', {}, n, p.uf.toUpperCase());
      h('span', { class: 'v' }, li, '+' + Math.abs(p.sw).toFixed(1));
      li.title = `${p.nm}: Lula ${p.x.toFixed(1)}% → ${p.y.toFixed(1)}% (${p.pct.toFixed(0)}% counted)`;
    }
  };
  fill('mvLula', [...big].sort((a, b) => b.sw - a.sw).slice(0, 8).filter(p => p.sw > 0), 'Lula', '--lula');
  fill('mvFlavio', [...big].sort((a, b) => a.sw - b.sw).slice(0, 8).filter(p => p.sw < 0), 'Flávio', '--flavio');
}

function renderStates() {
  const tb = $('stTable');
  tb.replaceChildren();
  const cols = [
    ['nm', 'State', ''], ['rg', 'Region', ''], ['ts', 'Counted', 'num'], ['l', 'Lula', 'num'], ['f', 'Flávio', 'num'],
    ['lead', 'Lead (votes)', 'num'], ['sw', 'Swing vs 1st (same areas)', 'num'], ['ht', 'Last update (local)', 'num'],
  ];
  const hr = h('tr', {}, h('thead', {}, tb));
  for (const [k, t, c] of cols) {
    const th = h('th', { class: c, 'aria-sort': S.sort.k === k ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none' }, hr, t + (S.sort.k === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''));
    th.addEventListener('click', () => { S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : k === 'nm' || k === 'rg' ? 1 : -1 }; renderStates(); });
  }
  const rows = A.UFS.map(uf => {
    const x = stateNow(uf) || {}, V = x.L + x.F;
    const c = A.compare((S.muns || []).filter(m => m.uf === uf));
    return { uf, nm: A.UF[uf].nm, rg: A.REGIONS.find(r => r.id === A.UF[uf].rg).nm, ts: x.ts ? x.st / x.ts : 0, l: V ? x.L / V : NaN, f: V ? x.F / V : NaN, lead: x.L - x.F, sw: c.swing, ht: x.ht || '' };
  });
  const { k, dir } = S.sort;
  rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (isFinite(a[k]) ? a[k] : -1e9) - (isFinite(b[k]) ? b[k] : -1e9)) * dir);
  const body = h('tbody', {}, tb);
  for (const r of rows) {
    const tr = h('tr', { class: 'clickable' }, body);
    tr.addEventListener('click', () => { setScope(r.uf); document.querySelector('.filters').scrollIntoView({ behavior: 'smooth' }); });
    h('td', { class: 'name' }, tr, r.nm);
    h('td', { class: 'name muted' }, tr, r.rg);
    h('td', { class: 'num' }, tr, pct(r.ts, 1));
    h('td', { class: 'num' }, tr, pct(r.l, 2));
    h('td', { class: 'num' }, tr, pct(r.f, 2));
    h('td', { class: 'num' }, tr, isFinite(r.lead) && r.lead ? `${r.lead > 0 ? 'Lula' : 'Flávio'} +${nf.format(Math.abs(r.lead))}` : '–');
    h('td', { class: 'num' }, tr, swingTxt(r.sw));
    h('td', { class: 'num' }, tr, r.ht);
  }
}

function renderScoped() {
  renderScopeControls();
  if (S.muns) {
    const cmp = A.compare(scopeMuns(S.scope));
    renderTiles(cmp);
    renderCompare();
    renderTransfers();
    renderMunicipalities();
  }
  renderTimeline();
}

function renderAll() {
  renderStatus();
  renderHero();
  renderScoped();
  renderStates();
}

// ---------- boot ----------
async function boot() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('theme', document.documentElement.dataset.theme);
  });
  const hash = location.hash.slice(1);
  if (hash && (A.UF[hash] || A.REGIONS.some(r => r.id === hash))) S.scope = hash;
  S.r1 = await getJSON('data/r1.json');
  S.r1Tot = {};
  for (const [key, row] of Object.entries(S.r1.rows)) S.r1Tot[key.slice(0, 2)] = (S.r1Tot[key.slice(0, 2)] || 0) + row[3];
  await Promise.allSettled([loadAgg(), loadLive()]);
  renderAll();
  setInterval(async () => { await loadLive().catch(() => 0); renderStatus(); renderHero(); renderStates(); renderTimeline(); }, LIVE_EVERY);
  setInterval(async () => { await loadAgg().catch(() => 0); renderScoped(); renderStates(); }, AGG_EVERY);
  setInterval(renderStatus, 1000);
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderScoped, 150); });
}
boot();
