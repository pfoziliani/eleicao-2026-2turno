import * as A from './analysis.js';
import { h, legend, lineChart, contribChart, mixBars, scatter, dumbbell, swingBar, fmtK, fmtTime, fmtTimeS, showTip, hideTip, dec } from './charts.js';

const TSE = 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados';
const LIVE_EVERY = 30e3, AGG_EVERY = 60e3;
const S = { scope: 'br', r1: null, r2: null, tl: null, fc: null, live: {}, liveRows: {}, lastLive: 0, lastAgg: 0, sort: { k: 'ts', dir: -1 } };

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('pt-BR');
const pct = (v, d = 2) => (isFinite(v) ? dec(100 * v, d) + '%' : '–');
const pp = (v, d = 1) => (isFinite(v) ? (v >= 0 ? '+' : '−') + dec(Math.abs(v), d) + ' p.p.' : '–');
const swingTxt = (v, d = 1) => (isFinite(v) ? (v >= 0 ? 'Lula +' : 'Flávio +') + dec(Math.abs(v), d) + ' p.p.' : '–');
const signedK = v => (v >= 0 ? '+' : '−') + fmtK(Math.abs(v));
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

// ---------- carregamento ----------
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
  const [r2, tl, fc] = await Promise.allSettled([getJSON('data/r2-mun.json' + q), getJSON('data/timeline.json' + q), getJSON('data/forecast.json' + q)]);
  if (r2.status === 'fulfilled') { S.r2 = r2.value; S.muns = A.joinMunicipalities(S.r1, S.r2); }
  if (tl.status === 'fulfilled') S.tl = tl.value;
  if (fc.status === 'fulfilled') S.fc = fc.value;
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

// Totais mais recentes por estado: TSE ao vivo se disponível, senão a última captura.
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

// O modelo é ajustado uma vez para o país (~0,2 s) a cada dado novo; cada recorte só
// reaplica essas taxas aos seus municípios, então trocar de recorte é instantâneo.
let fitCache = { key: null }, modelCache = { key: null };
function nationalFits() {
  const key = S.r2?.updated || '';
  if (fitCache.key !== key) fitCache = { key, fits: S.muns ? A.fitAll(S.muns) : null };
  return fitCache.fits;
}
function models() {
  const key = S.scope + '|' + (S.r2?.updated || '');
  if (modelCache.key !== key) {
    const ms = scopeMuns(S.scope), fits = nationalFits();
    modelCache = { key, rates: fits && A.transferRates(ms, fits), pred: fits && ms.some(m => m.r2?.est) ? A.predict(ms, fits) : null };
  }
  return modelCache;
}

// ---------- áreas e cores ----------
const REGION_COLOR = { N: '--r-N', NE: '--r-NE', CO: '--r-CO', SE: '--r-SE', S: '--r-S', EX: '--r-EX' };
function areasFor(scope) {
  if (scope === 'br') return A.REGIONS.map(r => ({ id: r.id, nm: r.nm, ufs: r.ufs, color: REGION_COLOR[r.id] }));
  const rg = A.REGIONS.find(r => r.id === scope);
  if (rg) {
    // Cor fixa por estado (pela posição no eleitorado da região); do 7º em diante vira "Outros".
    const ranked = [...rg.ufs].sort((a, b) => (S.r1Tot?.[b] || 0) - (S.r1Tot?.[a] || 0));
    const top = ranked.slice(0, ranked.length > 6 ? 5 : 6), rest = ranked.filter(u => !top.includes(u));
    const out = [...rg.ufs].filter(u => top.includes(u)).map(u => ({ id: u, nm: A.UF[u].nm, ufs: [u], color: '--c' + (top.indexOf(u) + 1) }));
    if (rest.length) out.push({ id: 'other', nm: 'Outros: ' + rest.map(u => u.toUpperCase()).join(', '), ufs: rest, color: '--c-other' });
    return out;
  }
  return [{ id: scope, nm: A.UF[scope].nm, ufs: [scope], color: '--c1' }];
}
const scopeName = s => (s === 'br' ? 'Brasil' : A.REGIONS.find(r => r.id === s)?.nm || A.UF[s].nm);
// Artigo de cada lugar, para "no Nordeste", "na Bahia", "em São Paulo", "do Brasil".
const ART = { br: 'o', N: 'o', NE: 'o', CO: 'o', SE: 'o', S: 'o', EX: 'o', ac: 'o', am: 'o', ap: 'o', ba: 'a', ce: 'o', df: 'o', es: 'o', ma: 'o', pa: 'o', pb: 'a', pi: 'o', pr: 'o', rj: 'o', rn: 'o', rs: 'o', to: 'o' };
const emName = s => ({ o: 'no ', a: 'na ' })[ART[s]] ?? 'em ';
const inScope = s => emName(s) + scopeName(s), ofScope = s => (({ o: 'do ', a: 'da ' })[ART[s]] ?? 'de ') + scopeName(s);
const scopeMuns = s => { const set = new Set(A.scopeUfs(s)); return (S.muns || []).filter(m => set.has(m.uf)); };

// ---------- renderização ----------
function renderStatus() {
  const br = S.live.br;
  const age = S.lastLive ? Math.round((Date.now() - S.lastLive) / 1000) : null;
  const next = S.lastLive ? Math.max(0, Math.round((S.lastLive + LIVE_EVERY - Date.now()) / 1000)) : 0;
  $('liveDot').classList.toggle('on', age != null && age < 90);
  $('status').textContent = br ? `TSE ${fmtTimeS(br.t)} (Brasília) · atualizado há ${age} s · próxima em ${next} s` : S.lastAgg ? 'TSE inacessível neste navegador · exibindo dados do coletor' : 'Conectando ao TSE…';
}

function renderHero() {
  const x = S.live.br || sumStates(A.UFS);
  if (!x || !x.L) return;
  const V = x.L + x.F, l = x.L / V, f = x.F / V, lead = x.L - x.F;
  $('hLula').textContent = pct(l);
  $('hFlavio').textContent = pct(f);
  $('hLulaV').textContent = nf.format(x.L) + ' votos';
  $('hFlavioV').textContent = nf.format(x.F) + ' votos';
  $('hLead').textContent = `${lead >= 0 ? 'Lula' : 'Flávio'} lidera por ${nf.format(Math.abs(lead))} votos`;
  $('hCounted').textContent = `${pct(x.st / x.ts)} das seções apuradas (${nf.format(x.st)} de ${nf.format(x.ts)})`;
  $('splitL').style.width = `calc(${100 * l}% - 1px)`;
  $('splitF').style.width = `calc(${100 * f}% - 1px)`;
  $('meterFill').style.width = (100 * x.st) / x.ts + '%';
  $('split').setAttribute('aria-label', `Lula ${pct(l)}, Flávio Bolsonaro ${pct(f)} dos votos válidos`);
  $('heroFoot').textContent = `Comparecimento nas seções apuradas ${pct(x.c / x.est, 1)} · brancos ${pct(x.vb / x.c, 1)} · nulos ${pct(x.vn / x.c, 1)} dos votos · Resultado final do 1º turno: Flávio 47,03%, Lula 45,16%, Cury 2,89%, Renan Santos 2,24%, Caiado 2,18%, outros 0,48%`;
}

function renderScopeControls() {
  const box = $('scopeBtns');
  if (!box.childElementCount) {
    for (const [id, nm] of [['br', 'Brasil'], ...A.REGIONS.map(r => [r.id, r.nm])]) {
      const b = h('button', { type: 'button', role: 'radio', 'data-id': id }, box, nm);
      b.addEventListener('click', () => setScope(id));
    }
    const sel = $('scopeState');
    h('option', { value: '' }, sel, 'Estado…');
    for (const uf of A.UFS.filter(u => u !== 'zz').sort((a, b) => A.UF[a].nm.localeCompare(A.UF[b].nm, 'pt-BR'))) h('option', { value: uf }, sel, A.UF[uf].nm);
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
  if (!cmp.r2.n) { h('p', { class: 'note' }, host, 'Nenhum município apurado ainda neste recorte.'); return; }
  tile(host, 'Lula · mesmos locais do 1º turno', pct(cmp.L2, 1), [{ b: pp(cmp.dL) }, ` ante ${pct(cmp.L1, 1)} em 4/10`], '--lula');
  tile(host, 'Flávio · mesmos locais do 1º turno', pct(cmp.F2, 1), [{ b: pp(cmp.dF) }, ` ante ${pct(cmp.F1, 1)} em 4/10`], '--flavio');
  tile(host, 'Swing líquido vs. 1º turno', swingTxt(cmp.swing), [`Lula tinha ${pct(cmp.L1two, 1)} dos votos dos dois em 4/10`]);
  tile(host, 'Comparecimento · mesmos locais', pct(cmp.turn2, 1), [{ b: pp(100 * (cmp.turn2 - cmp.turn1)) }, ` ante ${pct(cmp.turn1, 1)} em 4/10`]);
  tile(host, 'Brancos + nulos · mesmos locais', pct(cmp.bn2, 1), [{ b: pp(100 * (cmp.bn2 - cmp.bn1)) }, ` ante ${pct(cmp.bn1, 1)} dos votos`]);
  $('scopeNote').textContent = `${scopeName(S.scope)} · ${nf.format(cmp.r2.n)} municípios com votos apurados (${nf.format(cmp.r2.nFull)} completos) · dados de ${S.r2 ? fmtTime(Date.parse(S.r2.updated) / 1000) : '–'}`;
}

// Ponte do 1º turno ao 2º turno previsto: votos ganhos de cada origem, por candidato.
function renderForecast() {
  const head = $('fcHead'), tb = $('fcBridge'), note = $('fcNote');
  head.replaceChildren(); tb.replaceChildren(); note.textContent = '';
  const pr = models().pred;
  if (!pr) { h('p', { class: 'note' }, head, 'Ainda não há votos apurados neste recorte.'); return; }
  const b = pr.main, L = b.total[0], F = b.total[1], sL = L / (L + F), win = sL >= 0.5;
  const big = h('div', { class: 'fc-big' }, head);
  h('span', { class: 'key' }, big).style.background = `var(${win ? '--lula' : '--flavio'})`;
  big.append(S.scope === 'br'
    ? `${win ? 'Lula' : 'Flávio Bolsonaro'} vence com ${pct(win ? sL : 1 - sL, 1)} dos votos válidos`
    : `${win ? 'Lula' : 'Flávio'} à frente ${inScope(S.scope)}: ${pct(win ? sL : 1 - sL, 1)}`);
  const counted = scopeMuns(S.scope).reduce((a, m) => [a[0] + (m.r2?.est || 0), a[1] + m.r1.te], [0, 0]);
  const lo = dec(100 * pr.lo, 1), hi = dec(100 * pr.hi, 1);
  const range = lo === hi ? `os 3 modelos dão Lula ${lo}%` : `faixa entre os 3 modelos: Lula ${lo}–${hi}%`;
  h('p', { class: 'fc-sub' }, head, `${win ? 'Flávio' : 'Lula'} ${pct(win ? 1 - sL : sL, 1)} · vantagem prevista de ${fmtK(Math.abs(L - F))} votos · ${range} · base: ${pct(counted[0] / counted[1], 0)} do eleitorado já apurado`);
  const split = h('div', { class: 'split small', role: 'img', 'aria-label': `Previsão: Lula ${pct(sL, 1)}, Flávio ${pct(1 - sL, 1)}` }, head);
  h('div', { class: 'seg lula' }, split).style.width = `calc(${100 * sL}% - 1px)`;
  h('div', { class: 'seg flavio' }, split).style.width = `calc(${100 * (1 - sL)}% - 1px)`;
  h('div', { class: 'half' }, split);
  renderForecastHistory();

  const rows = [
    { nm: '1º turno (4/10)', L: b.r1[0], F: b.r1[1], kind: 'base' },
    { nm: 'Eleitores de Augusto Cury', s: 2 },
    { nm: 'Eleitores de Renan Santos', s: 3 },
    { nm: 'Eleitores de Ronaldo Caiado', s: 4 },
    { nm: 'Eleitores de Zema e outros', s: 5 },
    { nm: 'Quem votou branco/nulo no 1º turno', s: 6 },
    { nm: 'Quem não votou no 1º turno (comparecimento)', s: 7 },
    { nm: 'Eleitores do adversário que trocaram de lado', L: b.flows[1][0], F: b.flows[0][1], pL: b.flows[1][0] / b.r1[1], pF: b.flows[0][1] / b.r1[0] },
    { nm: 'Eleitores próprios que não repetiram o voto', L: -(b.r1[0] - b.flows[0][0]), F: -(b.r1[1] - b.flows[1][1]), pL: 1 - b.flows[0][0] / b.r1[0], pF: 1 - b.flows[1][1] / b.r1[1] },
    { nm: '2º turno previsto', L, F, kind: 'total' },
  ].map(r => (r.s != null ? { ...r, L: b.flows[r.s][0], F: b.flows[r.s][1], pL: b.flows[r.s][0] / b.r1[r.s], pF: b.flows[r.s][1] / b.r1[r.s], base: b.r1[r.s] } : r));
  const max = Math.max(...rows.filter(r => !r.kind).flatMap(r => [Math.abs(r.L), Math.abs(r.F)]));
  const hr = h('tr', {}, h('thead', {}, tb));
  h('th', {}, hr, 'Origem dos votos');
  for (const [nm, color] of [['Lula', '--lula'], ['Flávio Bolsonaro', '--flavio']]) {
    const th = h('th', {}, hr);
    h('span', { class: 'swatch' }, th).style.background = `var(${color})`;
    th.append(nm);
  }
  const body = h('tbody', {}, tb);
  for (const r of rows) {
    const tr = h('tr', { class: r.kind || '' }, body);
    const name = h('td', { class: 'name' }, tr, r.nm);
    if (r.base) h('small', {}, name, ` · ${fmtK(r.base)} em 4/10`);
    for (const [v, p, color, who] of [[r.L, r.pL, '--lula', 'Lula'], [r.F, r.pF, '--flavio', 'Flávio']]) {
      const td = h('td', { class: 'bcell' }, tr);
      if (r.kind) {
        h('span', { class: 'bval' }, td, r.kind === 'total' ? `${fmtK(v)} · ${pct(v / (L + F), 1)}` : fmtK(v));
        continue;
      }
      const wrap = h('div', { class: 'bbar' }, td);
      const bar = h('div', { class: 'b' + (v < 0 ? ' neg' : '') }, wrap);
      bar.style.width = `${Math.max(1, (100 * Math.abs(v)) / max) * 0.72}%`;
      bar.style.background = `var(${color})`;
      h('span', { class: 'bval' }, wrap, signedK(v) + (isFinite(p) ? ` (${dec(100 * p, 0)}%)` : ''));
      td.addEventListener('pointermove', ev => showTip(ev, `${r.nm} → ${who}`, [{ k: 'Votos (est.)', v: signedK(v), color }, ...(isFinite(p) ? [{ k: v < 0 ? '% dos eleitores próprios' : '% do grupo', v: dec(100 * p, 1) + '%' }] : [])]));
      td.addEventListener('pointerleave', hideTip);
    }
  }
  note.textContent = `Saldo sobre o 1º turno: Lula ${signedK(L - b.r1[0])} · Flávio ${signedK(F - b.r1[1])}. “Não repetiram o voto” = migraram para o adversário, anularam/votaram em branco ou não foram votar. Percentuais entre parênteses: fatia de cada grupo do 1º turno que foi para o candidato. Estimativa de modelo, não pesquisa — a margem real pode ser diferente, sobretudo no começo da apuração.`;
}

// Série da previsão: um ponto a cada atualização dos dados municipais (~2 min).
function renderForecastHistory() {
  const rows = S.fc?.series?.[S.scope] || [], co = $('fcCallout');
  co.replaceChildren();
  legend($('lgFc'), [
    { nm: 'Lula (previsão)', color: '--lula', line: true }, { nm: 'Flávio (previsão)', color: '--flavio', line: true },
    { nm: 'Faixa entre modelos', color: '--ink2', band: true },
    { nm: 'Lula (contagem)', color: '--lula', line: true, faint: true }, { nm: 'Flávio (contagem)', color: '--flavio', line: true, faint: true },
  ]);
  if (rows.length < 2) { $('chFc').replaceChildren(); h('p', { class: 'note' }, $('chFc'), 'A série aparece a partir da segunda atualização neste recorte.'); return; }
  const P = 100, at = new Map(rows.map(r => [r[0], r]));
  const series = [
    { id: 'pl', nm: 'Lula', color: '--lula', pts: rows.map(r => [r[0], P * r[1]]), band: rows.map(r => [r[0], P * r[2], P * r[3]]) },
    { id: 'pf', nm: 'Flávio', color: '--flavio', pts: rows.map(r => [r[0], P * (1 - r[1])]), band: rows.map(r => [r[0], P * (1 - r[3]), P * (1 - r[2])]) },
    { id: 'rl', nm: 'Lula (contagem)', color: '--lula', faint: true, pts: rows.map(r => [r[0], P * r[4]]) },
    { id: 'rf', nm: 'Flávio (contagem)', color: '--flavio', faint: true, pts: rows.map(r => [r[0], P * (1 - r[4])]) },
  ];
  const vals = rows.flatMap(r => [r[2], r[3], r[4], 1 - r[2], 1 - r[3], 1 - r[4]].map(v => P * v));
  const lo = Math.min(49, Math.floor(Math.min(...vals) - 0.5)), hi = Math.max(51, Math.ceil(Math.max(...vals) + 0.5));
  lineChart($('chFc'), {
    series, y0: lo, y1: hi, yFmt: v => dec(v, 0) + '%', tipFmt: v => dec(v, 2) + '%', endFmt: v => dec(v, 1) + '%', refs: [{ v: 50 }], height: 240,
    tipExtra: t => { const r = at.get(t); return r ? `${pct(r[5], 0)} do eleitorado apurado · faixa Lula ${dec(P * r[2], 1)}–${dec(P * r[3], 1)}%` : ''; },
  });
  const first = rows[0], last = rows[rows.length - 1];
  const ps = rows.map(r => r[1]), mn = Math.min(...ps), mx = Math.max(...ps);
  const lulaAhead = rows.filter(r => r[1] >= 0.5).length;
  const tMin = rows[ps.indexOf(mn)][0], tMax = rows[ps.indexOf(mx)][0];
  co.append(`Previsão para Lula: ${pct(first[1], 1)} às ${fmtTime(first[0])} (${pct(first[5], 0)} do eleitorado apurado) → `);
  h('b', {}, co, `${pct(last[1], 1)} às ${fmtTime(last[0])}`);
  co.append(` (${pct(last[5], 0)} apurado), variação de ${pp(100 * (last[1] - first[1]))}; mínimo ${pct(mn, 1)} (${fmtTime(tMin)}), máximo ${pct(mx, 1)} (${fmtTime(tMax)}). `);
  const who = S.scope === 'br' ? 'o vencedor previsto' : 'à frente na previsão';
  h('b', {}, co, lulaAhead === rows.length ? `Lula foi ${who} em todas as ${rows.length} atualizações.` : lulaAhead === 0 ? `Flávio foi ${who} em todas as ${rows.length} atualizações.` : `A previsão mudou de lado: Lula ${who} em ${lulaAhead} de ${rows.length} atualizações.`);
  co.append(` Na contagem bruta, Lula foi de ${pct(first[4], 1)} para ${pct(last[4], 1)} no mesmo período.`);
}

function renderCompare() {
  const tb = $('cmpTable');
  tb.replaceChildren();
  const head = h('tr', {}, h('thead', {}, tb));
  for (const [t, c] of [['Área', ''], ['Apurado', 'num'], ['Lula: 1º → 2º', ''], ['Lula', 'num'], ['Δ', 'num'], ['Flávio: 1º → 2º', ''], ['Flávio', 'num'], ['Δ', 'num'], ['Swing líquido', ''], ['', 'num'], ['Comparec. Δ', 'num']]) h('th', { class: c }, head, t);
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
  rows.push({ id: 'all', nm: isState ? `${A.UF[S.scope].nm} (todo o apurado)` : `Total ${scopeName(S.scope)}`, muns: scopeMuns(S.scope), counted: tot.ts ? tot.st / tot.ts : NaN, total: true });
  for (const r of rows) {
    const c = A.compare(r.muns);
    const tr = h('tr', { class: r.click ? 'clickable' : '' }, body);
    if (r.total) tr.style.fontWeight = '600';
    if (r.click) tr.addEventListener('click', () => setScope(r.click));
    const name = h('td', { class: 'name' }, tr);
    if (r.color) h('span', { class: 'swatch' }, name).style.background = `var(${r.color})`;
    name.appendChild(document.createTextNode(r.nm));
    h('td', { class: 'num' }, tr, pct(r.counted, 1));
    if (!c.r2.n) { h('td', { colspan: 9, class: 'muted' }, tr, 'ainda não apurado'); continue; }
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

// Abstenção: 2º turno apurado vs. 1º turno nos mesmos locais (proporcional ao eleitorado apurado).
const FOCUS = ['ba38490', 'ba35157', 'ba36854', 'sp71072', 'pi12190', 'pb20516'];
const abstOf = c => ({ a2: 1 - c.turn2, a1: 1 - c.turn1, d: 100 * (c.turn1 - c.turn2) });
function renderAbstention() {
  const all = scopeMuns(S.scope), c = A.compare(all), host = $('abTiles');
  host.replaceChildren();
  if (!c.r2.n) { h('p', { class: 'note' }, host, 'Ainda não há votos apurados neste recorte.'); return; }
  const ab = abstOf(c);
  tile(host, `Abstenção · ${scopeName(S.scope)} (seções apuradas)`, pct(ab.a2, 1), [{ b: pp(ab.d) }, ` ante ${pct(ab.a1, 1)} no 1º turno, nos mesmos locais`]);
  tile(host, 'Eleitores a mais votando que no 1º turno', signedK((c.turn2 - c.turn1) * c.r2.e), [`nas seções já apuradas (${fmtK(c.r2.e)} eleitores)`]);
  // Linhas: estados (Brasil ou região) ou maiores municípios (estado).
  const isState = A.UF[S.scope];
  let rows;
  if (isState) rows = all.filter(m => m.r2?.est).sort((a, b) => b.r1.te - a.r1.te).slice(0, 15).map(m => ({ nm: title(m.nm), c: A.compare([m]) }));
  else rows = A.scopeUfs(S.scope).map(uf => ({ nm: A.UF[uf].nm, uf, c: A.compare(all.filter(m => m.uf === uf)) }));
  rows = rows.filter(r => r.c.r2.n).map(r => ({ ...r, ...abstOf(r.c) })).sort((a, b) => b.d - a.d);
  const up = rows.filter(r => r.d > 0).length;
  tile(host, isState ? 'Municípios grandes com aumento da abstenção' : 'Estados com aumento da abstenção', `${up} de ${rows.length}`, [up ? `maior alta: ${rows[0].nm} ${pp(rows[0].d)}` : `maior queda: ${rows[rows.length - 1].nm} ${pp(rows[rows.length - 1].d)}`]);
  $('abBarsCap').firstChild.textContent = `Variação da abstenção vs. 1º turno, nos mesmos locais — ${isState ? 'maiores municípios' : 'por estado'} `;
  const bars = $('abBars');
  bars.replaceChildren();
  const max = Math.max(1, ...rows.map(r => Math.abs(r.d)));
  for (const r of rows) {
    const row = h('div', { class: 'ab-row' + (r.uf ? ' clickable' : '') }, bars);
    if (r.uf) row.addEventListener('click', () => setScope(r.uf));
    h('span', { class: 'ab-nm' }, row, r.nm);
    const track = h('span', { class: 'ab-track' }, row);
    const bar = h('span', { class: 'ab-bar' + (r.d > 0 ? ' up' : '') }, track);
    bar.style.width = (50 * Math.abs(r.d)) / max + '%';
    bar.style[r.d > 0 ? 'left' : 'right'] = '50%';
    h('span', { class: 'ab-v' }, row, `${pp(r.d)} · ${pct(r.a1, 1)} → ${pct(r.a2, 1)}`);
    row.addEventListener('pointermove', ev => showTip(ev, r.nm, [{ k: 'Abstenção 1º turno (mesmos locais)', v: pct(r.a1, 2) }, { k: 'Abstenção 2º turno', v: pct(r.a2, 2) }, { k: 'Variação', v: pp(r.d, 2) }, { k: 'Eleitorado apurado', v: fmtK(r.c.r2.e) }]));
    row.addEventListener('pointerleave', hideTip);
  }

  // Cidades citadas: variação na cidade vs. no resto do estado e efeito estimado na margem.
  const tb = $('abFocus');
  tb.replaceChildren();
  const hr = h('tr', {}, h('thead', {}, tb));
  for (const [t, cl] of [['Cidade', ''], ['Apurado', 'num'], ['Abstenção 1º → 2º', 'num'], ['Δ cidade', 'num'], ['Δ resto do estado', 'num'], ['Diferença', 'num'], ['Efeito na margem*', 'num']]) h('th', { class: cl }, hr, t);
  const body = h('tbody', {}, tb);
  let net = 0;
  for (const key of FOCUS) {
    const m = (S.muns || []).find(x => x.key === key);
    if (!m) continue;
    const cc = A.compare([m]), rest = A.compare((S.muns || []).filter(x => x.uf === m.uf && x.key !== key));
    const tr = h('tr', {}, body);
    const nm = h('td', { class: 'name' }, tr, title(m.nm) + ' ');
    h('span', { class: 'muted' }, nm, m.uf.toUpperCase());
    if (!cc.r2.n) { h('td', { colspan: 6, class: 'muted' }, tr, 'ainda não apurado'); continue; }
    const a = abstOf(cc), b = abstOf(rest), diff = a.d - b.d;
    // Eleitores "a mais" (ou a menos) que o padrão do resto do estado, votando como quem votou na cidade.
    const extra = (-diff / 100) * m.r1.te, eff = extra * ((m.r2.v13 - m.r2.v22) / m.r2.c);
    net += eff;
    h('td', { class: 'num' }, tr, pct(m.r2.est / m.r1.te, 0));
    h('td', { class: 'num' }, tr, `${pct(a.a1, 1)} → ${pct(a.a2, 1)}`);
    h('td', { class: 'num' }, tr, pp(a.d));
    h('td', { class: 'num' }, tr, pp(b.d));
    h('td', { class: 'num' }, tr, pp(diff));
    h('td', { class: 'num' }, tr, `${eff >= 0 ? 'Lula' : 'Flávio'} +${fmtK(Math.abs(eff))}`);
  }
  const br = S.live.br, lead = br ? Math.abs(br.L - br.F) : NaN;
  $('abFocusNote').textContent = `* Votos líquidos que o candidato indicado ganhou porque a abstenção na cidade variou diferente do resto do estado: se ela tivesse acompanhado o resto do estado, ele teria esse tanto a menos de vantagem (supondo que os eleitores a mais ou a menos votassem como os demais da cidade). Somando as ${FOCUS.length} cidades: ${net >= 0 ? 'Lula' : 'Flávio'} +${fmtK(Math.abs(net))} votos líquidos${isFinite(lead) ? `, frente a uma vantagem nacional atual de ${fmtK(lead)}` : ''}. A diferença reflete tudo o que mudou na cidade entre os turnos (transporte, mobilização, prorrogação) — não isola o efeito da prorrogação.`;

  // Municípios com maiores altas e quedas.
  const big = (S.muns || []).filter(m => m.r1.te >= 20000 && m.r2?.est && m.r2.est / m.r1.te >= 0.9).map(m => ({ m, ...abstOf(A.compare([m])) }));
  const fill = (id, list, label) => {
    const ol = $(id);
    ol.replaceChildren();
    h('li', { class: 'head' }, ol, label);
    for (const x of list) {
      const li = h('li', {}, ol);
      const n = h('span', { class: 'nm' }, li, title(x.m.nm) + ' ');
      h('small', {}, n, x.m.uf.toUpperCase());
      h('span', { class: 'v' }, li, pp(x.d));
      li.title = `${title(x.m.nm)}: ${pct(x.a1, 1)} → ${pct(x.a2, 1)}`;
    }
  };
  fill('abUp', [...big].sort((a, b) => b.d - a.d).slice(0, 8), 'Abstenção subiu');
  fill('abDown', [...big].sort((a, b) => a.d - b.d).slice(0, 8), 'Abstenção caiu');
}

const DEST_CLASS = ['lula', 'flavio', 'bn', 'abst'];
const DEST_COLOR = ['--lula', '--flavio', '--bn', '--abst'];
function renderTransfers() {
  const fit = models().rates;
  legend($('trLegend'), A.DESTS.map((d, i) => ({ nm: d.nm + ' (2º turno)', color: DEST_COLOR[i] })));
  const host = $('trBars');
  host.replaceChildren();
  if (!fit) { h('p', { class: 'note' }, host, 'Ainda não há votos apurados neste recorte.'); return; }
  $('trDesc').textContent = `Como cada grupo de eleitores de 4/10 parece estar se dividindo em 25/10 ${fit.n === 1 ? 'no município apurado' : `nos ${nf.format(fit.n)} municípios apurados`} ${ofScope(S.scope)}, com taxas inferidas de como os resultados mudaram nos ${nf.format(fit.nFit)} municípios apurados do país (modelo ${fit.models[0]}: cada estado com seu ajuste, ou o da região se tiver poucos municípios). É uma estimativa ecológica de fluxos agregados, não uma pesquisa com eleitores: quando as variantes do modelo divergem, a faixa abaixo de cada barra mostra o quanto. Trate como indicativo, sobretudo no início da apuração.`;
  const order = [2, 3, 4, 5, 6, 7, 0, 1];
  order.forEach((i, k) => {
    if (k === 6) h('div', { class: 'tr-sep' }, host);
    const src = A.SOURCES[i];
    const nm = h('div', { class: 'tr-name' }, host, src.nm);
    h('small', {}, nm, src.sub);
    const cell = h('div', {}, host);
    const bar = h('div', { class: 'tr-bar' }, cell);
    if (fit.models.length > 1 && i > 1) {
      const rg = d => fit.range[i][d].map(v => Math.round(100 * v)), [l0, l1] = rg(0), [f0, f1] = rg(1);
      h('div', { class: 'tr-range' }, cell, `Faixa entre ${fit.models.length} variantes do modelo: Lula ${l0}–${l1}% · Flávio ${f0}–${f1}%`);
    }
    fit.T[i].forEach((p, d) => {
      if (p < 0.0005) return;
      const seg = h('div', { class: DEST_CLASS[d] }, bar);
      seg.style.width = `calc(${100 * p}% - 2px)`;
      if (p >= 0.09) seg.textContent = Math.round(100 * p) + '%';
      const [r0, r1] = fit.range[i][d];
      seg.addEventListener('pointermove', ev => showTip(ev, `Eleitores de ${src.nm} (1º turno) → ${A.DESTS[d].nm}`, [{ k: 'Estimativa', v: dec(100 * p, 1) + '%', color: DEST_COLOR[d] }, ...(fit.models.length > 1 ? [{ k: 'Faixa entre modelos', v: `${Math.round(100 * r0)}–${Math.round(100 * r1)}%` }] : []), { k: 'Votos (est., áreas apuradas)', v: '≈ ' + fmtK(fit.flows[i][d]) }]));
      seg.addEventListener('pointerleave', hideTip);
    });
    h('div', { class: 'tr-votes' }, host, `${fmtK(fit.tot[i])} em 4/10`);
  });
}

function renderTimeline() {
  const series = mergedSeries();
  const G = A.buildGrid(series);
  if (!G) return;
  const ufs = A.scopeUfs(S.scope), areas = areasFor(S.scope);
  const sums = G.times.map((_, i) => A.sumAt(G, ufs, i));
  const valid = sums.map((s, i) => [G.times[i], s]).filter(([, s]) => s.L + s.F > 0);
  $('tlDesc').textContent = `${scopeName(S.scope)} · horário de Brasília · arquivos do TSE capturados a cada 20 s desde ${fmtTime(G.times[0])} (o TSE começou a divulgar às 19:00; os primeiros ~30 min não foram registrados).`;
  legend($('lgShare'), [{ nm: 'Lula', color: '--lula', line: true }, { nm: 'Flávio Bolsonaro', color: '--flavio', line: true }]);
  const shL = valid.map(([t, s]) => [t, (100 * s.L) / (s.L + s.F)]), shF = valid.map(([t, s]) => [t, (100 * s.F) / (s.L + s.F)]);
  const all = [...shL, ...shF].map(p => p[1]);
  const lo = Math.min(45, Math.floor(Math.min(...all) - 1)), hi = Math.max(55, Math.ceil(Math.max(...all) + 1));
  lineChart($('chShare'), {
    series: [{ id: 'l', nm: 'Lula', color: '--lula', pts: shL }, { id: 'f', nm: 'Flávio', color: '--flavio', pts: shF }],
    y0: lo, y1: hi, yFmt: v => dec(v, 0) + '%', tipFmt: v => dec(v, 2) + '%', refs: [{ v: 50 }],
    tipExtra: t => { const i = G.times.indexOf(t), s = sums[i]; return s ? `${dec((100 * s.st) / s.ts, 1)}% das seções apuradas` : ''; },
  });
  legend($('lgProg'), [...areas.map(a => ({ nm: a.nm, color: a.color, line: true })), ...(areas.length > 1 ? [{ nm: 'Total', color: '--muted', line: true }] : [])]);
  const prog = areas.map(a => ({ id: a.id, nm: a.nm, color: a.color, pts: G.times.map((t, i) => { const s = A.sumAt(G, a.ufs, i); return [t, s.ts ? (100 * s.st) / s.ts : 0]; }) }));
  if (areas.length > 1) prog.push({ id: 'all', nm: 'Total', color: '--muted', pts: G.times.map((t, i) => [t, sums[i].ts ? (100 * sums[i].st) / sums[i].ts : 0]) });
  lineChart($('chProg'), { series: prog, y0: 0, y1: 100, yFmt: v => dec(v, 0) + '%', tipFmt: v => dec(v, 1) + '%', endLabels: false });

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
    const phrase = r => `${r.a.nm} ${r.v >= 0 ? 'puxou para Lula' : 'puxou para Flávio'} ${dec(Math.abs(r.v), 2)} p.p.`;
    co.append('Últimos 30 min: ');
    h('b', {}, co, phrase(r30[0]));
    if (r30[1]) co.append('; ' + phrase(r30[1]) + ' ');
    co.append(`Desde ${fmtTime(bins[0].t0)}: `);
    h('b', {}, co, phrase(rAll[0]));
    if (rAll[1]) co.append('; ' + phrase(rAll[1]));
  }

  // Composição: votos apurados vs. eleitorado, por área.
  const last = G.times.length - 1;
  const cnt = areas.map(a => { const s = A.sumAt(G, a.ufs, last); return s.L + s.F; });
  const elec = areas.map(a => A.sumAt(G, a.ufs, last).te);
  mixBars($('chMix'), { rows: [{ nm: 'Votos apurados', vals: cnt, unit: 'Votos válidos apurados' }, { nm: 'Eleitorado', vals: elec, unit: 'Eleitores aptos' }], areas });
  const tc = cnt.reduce((s, v) => s + v, 0), te = elec.reduce((s, v) => s + v, 0);
  if (tc && areas.length > 1) {
    const gaps = areas.map((a, i) => ({ a, i, g: cnt[i] / tc - elec[i] / te })).sort((x, y) => x.g - y.g);
    const u = gaps[0], o = gaps[gaps.length - 1];
    $('mixNote').textContent = `${u.a.nm} tem ${pct(elec[u.i] / te, 0)} do eleitorado, mas só ${pct(cnt[u.i] / tc, 0)} dos votos apurados até agora; ${o.a.nm} está sobrerrepresentado (${pct(cnt[o.i] / tc, 0)} dos votos apurados vs. ${pct(elec[o.i] / te, 0)} do eleitorado). O que falta apurar tende a puxar o total para o padrão de votação das áreas sub-representadas.`;
  } else $('mixNote').textContent = '';

  // Grupos por horário de fechamento (fuso).
  const tz = $('tzTable');
  tz.replaceChildren();
  const hr = h('tr', {}, h('thead', {}, tz));
  for (const [t, c] of [['Urnas fecharam', ''], ['Apurado', 'num'], ['Lula', 'num'], ['Flávio', 'num'], ['Swing vs. 1º', 'num']]) h('th', { class: c }, hr, t);
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
  legend($('lgMun'), [{ nm: 'Lula à frente', color: '--lula' }, { nm: 'Flávio à frente', color: '--flavio' }]);
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
    hd.append(`A favor de ${nm}`);
    if (!list.length) h('li', { class: 'muted' }, ol, '–');
    for (const p of list) {
      const li = h('li', {}, ol);
      const n = h('span', { class: 'nm' }, li, p.nm + ' ');
      h('small', {}, n, p.uf.toUpperCase());
      h('span', { class: 'v' }, li, '+' + dec(Math.abs(p.sw), 1));
      li.title = `${p.nm}: Lula ${dec(p.x, 1)}% → ${dec(p.y, 1)}% (${dec(p.pct, 0)}% apurado)`;
    }
  };
  fill('mvLula', [...big].sort((a, b) => b.sw - a.sw).slice(0, 8).filter(p => p.sw > 0), 'Lula', '--lula');
  fill('mvFlavio', [...big].sort((a, b) => a.sw - b.sw).slice(0, 8).filter(p => p.sw < 0), 'Flávio', '--flavio');
}

function renderStates() {
  const tb = $('stTable');
  tb.replaceChildren();
  const cols = [
    ['nm', 'Estado', ''], ['rg', 'Região', ''], ['ts', 'Apurado', 'num'], ['l', 'Lula', 'num'], ['f', 'Flávio', 'num'],
    ['lead', 'Vantagem (votos)', 'num'], ['sw', 'Swing vs. 1º (mesmos locais)', 'num'], ['ht', 'Última atualização (local)', 'num'],
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
  rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k], 'pt-BR') : (isFinite(a[k]) ? a[k] : -1e9) - (isFinite(b[k]) ? b[k] : -1e9)) * dir);
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
    renderTiles(A.compare(scopeMuns(S.scope)));
    renderForecast();
    renderCompare();
    renderAbstention();
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

// ---------- inicialização ----------
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
