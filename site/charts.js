// Minimal SVG chart kit: scales, ticks, tooltip, and the four chart forms the dashboard uses.
const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
export function h(tag, attrs = {}, parent, text) {
  const e = document.createElement(tag);
  for (const k in attrs) k === 'class' ? (e.className = attrs[k]) : e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export const scale = (d0, d1, r0, r1) => {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = v => r0 + (v - d0) * k;
  f.inv = p => d0 + (p - r0) / k;
  return f;
};

export function ticks(min, max, count = 5) {
  const span = max - min || 1, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw)), e = raw / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const TZ = 'America/Sao_Paulo';
export const dec = (v, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtTime = t => new Date(t * 1000).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtTimeS = t => new Date(t * 1000).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
function timeTicks(t0, t1, target) {
  const step = [300, 600, 900, 1800, 3600, 7200, 10800].find(s => (t1 - t0) / s <= target) || 10800;
  const out = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
  return out;
}

// ---- Tooltip (one shared element; content built with textContent only) ----
const tip = () => document.getElementById('tip');
export function showTip(evt, title, rows, foot) {
  const t = tip();
  t.replaceChildren();
  if (title) h('div', { class: 't' }, t, title);
  for (const r of rows) {
    if (r === '-') { h('hr', {}, t); continue; }
    const row = h('div', { class: 'row' }, t);
    const k = h('span', { class: 'k' }, row);
    if (r.color) { const i = h('i', {}, k); i.style.background = `var(${r.color})`; }
    k.appendChild(document.createTextNode(r.k));
    h('span', { class: 'v' }, row, r.v);
  }
  if (foot) h('div', { class: 't' }, t, foot).style.marginTop = '4px';
  t.hidden = false;
  const pad = 14, w = t.offsetWidth, hh = t.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (y + hh > innerHeight - 8) y = evt.clientY - hh - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
}
export const hideTip = () => { tip().hidden = true; };

export function legend(host, items) {
  host.replaceChildren();
  for (const it of items) {
    const s = h('span', { class: 'item' }, host);
    const sw = h('span', { class: it.line ? 'ln' : 'sw' }, s);
    sw.style.background = `var(${it.color})`;
    if (it.faint) sw.style.opacity = 0.45;
    if (it.band) sw.style.opacity = 0.18;
    s.appendChild(document.createTextNode(it.nm));
  }
}

// ---- Line chart with crosshair ----
// series: [{ id, nm, color, pts: [[t, v], ...] }]
export function lineChart(host, { series, y0, y1, yFmt, height = 230, refs = [], endLabels = true, tipFmt = yFmt, endFmt = yFmt, tipExtra }) {
  host.replaceChildren();
  const pts = series.flatMap(s => s.pts);
  if (pts.length < 2) { h('p', { class: 'note' }, host, 'Aguardando mais capturas…'); return; }
  const W = Math.max(300, host.clientWidth), H = height, m = { l: 40, r: endLabels ? 92 : 12, t: 10, b: 24 };
  const t0 = Math.min(...pts.map(p => p[0])), t1 = Math.max(...pts.map(p => p[0]));
  const x = scale(t0, t1, m.l, W - m.r), y = scale(y0, y1, H - m.b, m.t);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, host);
  for (const v of ticks(y0, y1, 4)) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
    el('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg, yFmt(v));
  }
  el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axis' }, svg);
  for (const t of timeTicks(t0, t1, Math.max(3, Math.floor((W - m.l - m.r) / 70))))
    el('text', { x: x(t), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg, fmtTime(t));
  for (const r of refs) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(r.v), y2: y(r.v), class: 'ref' }, svg);
    if (r.nm) el('text', { x: m.l + 4, y: y(r.v) - 4, class: 'tick' }, svg, r.nm);
  }
  const ends = [];
  // Range bands (e.g. spread across model variants) go under every line.
  for (const s of series) {
    if (!s.band?.length) continue;
    const up = s.band.map((b, i) => (i ? 'L' : 'M') + x(b[0]).toFixed(1) + ',' + y(b[2]).toFixed(1)).join('');
    const dn = [...s.band].reverse().map(b => 'L' + x(b[0]).toFixed(1) + ',' + y(b[1]).toFixed(1)).join('');
    el('path', { d: up + dn + 'Z', fill: `var(${s.color})`, 'fill-opacity': 0.14, stroke: 'none' }, svg);
  }
  for (const s of series) {
    if (!s.pts.length) continue;
    const d = s.pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join('');
    el('path', { d, class: 'line', stroke: `var(${s.color})`, ...(s.faint ? { 'stroke-width': 1.5, 'stroke-opacity': 0.45 } : {}) }, svg);
    if (s.faint) continue;
    const last = s.pts[s.pts.length - 1];
    el('circle', { cx: x(last[0]), cy: y(last[1]), r: 4, fill: `var(${s.color})`, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
    ends.push({ s, yy: y(last[1]), v: last[1] });
  }
  // End labels only when they don't collide (the legend carries identity otherwise).
  if (endLabels) {
    ends.sort((a, b) => a.yy - b.yy);
    const clear = ends.every((e, i) => i === 0 || e.yy - ends[i - 1].yy >= 14);
    if (clear) for (const e of ends) el('text', { x: W - m.r + 8, y: e.yy + 4, class: 'lbl' }, svg, `${e.s.nm} ${endFmt(e.v)}`);
  }
  const hair = el('line', { y1: m.t, y2: H - m.b, class: 'xhair', visibility: 'hidden' }, svg);
  const dots = series.map(s => el('circle', { r: 4, fill: `var(${s.color})`, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden', 'pointer-events': 'none' }, svg));
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: 'hit' }, svg);
  const nearest = (s, t) => { let best = null; for (const p of s.pts) if (p[0] <= t + 1 && (!best || p[0] > best[0])) best = p; return best || s.pts[0]; };
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const t = x.inv(((ev.clientX - r.left) * W) / r.width);
    const times = series[0].pts.map(p => p[0]);
    const tt = times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), times[0]);
    hair.setAttribute('x1', x(tt)); hair.setAttribute('x2', x(tt)); hair.setAttribute('visibility', 'visible');
    const rows = series.map((s, i) => {
      const p = nearest(s, tt);
      dots[i].setAttribute('cx', x(p[0])); dots[i].setAttribute('cy', y(p[1])); dots[i].setAttribute('visibility', 'visible');
      return { k: s.nm, v: tipFmt(p[1]), color: s.color, val: p[1] };
    }).sort((a, b) => b.val - a.val);
    showTip(ev, fmtTime(tt) + ' (Brasília)', rows, tipExtra?.(tt));
  });
  hit.addEventListener('pointerleave', () => { hideTip(); hair.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); });
}

// ---- Diverging stacked columns (contribution of each area per time bin) ----
export function contribChart(host, { bins, areas, height = 240 }) {
  host.replaceChildren();
  if (!bins.length) { h('p', { class: 'note' }, host, 'Aguardando mais capturas…'); return; }
  const W = Math.max(300, host.clientWidth), H = height, m = { l: 48, r: 12, t: 10, b: 24 };
  let ext = 0.05;
  for (const b of bins) {
    const pos = b.parts.reduce((s, p) => s + Math.max(0, p.pp), 0), neg = b.parts.reduce((s, p) => s + Math.min(0, p.pp), 0);
    ext = Math.max(ext, pos, -neg);
  }
  const y = scale(-ext, ext, H - m.b, m.t);
  const band = (W - m.l - m.r) / bins.length, bw = Math.max(3, Math.min(24, band * 0.72));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, host);
  for (const v of ticks(-ext, ext, 4)) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg, (v > 0 ? '+' : '') + dec(v, Math.abs(ext) < 1 ? 2 : 1));
  }
  const every = Math.max(1, Math.ceil(56 / band));
  bins.forEach((b, i) => {
    const cx = m.l + band * i + band / 2;
    if (i % every === 0) el('text', { x: cx, y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg, fmtTime(b.t0));
    const g = el('g', { class: 'col', tabindex: 0 }, svg);
    el('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, class: 'colbg' }, g);
    let up = 0, dn = 0;
    for (const p of b.parts) {
      if (!p.pp) continue;
      const a0 = p.pp > 0 ? up : dn, a1 = a0 + p.pp;
      if (p.pp > 0) up = a1; else dn = a1;
      const yA = y(Math.max(a0, a1)), yB = y(Math.min(a0, a1));
      const hgt = Math.max(0, yB - yA - 2);
      if (hgt < 0.5) continue;
      el('rect', { x: cx - bw / 2, y: yA + 1, width: bw, height: hgt, rx: 2, fill: `var(${areas.find(a => a.id === p.id)?.color || '--c-other'})`, class: 'seg' }, g);
    }
    const show = ev => {
      const rows = [...b.parts].sort((p, q) => q.pp - p.pp).filter(p => Math.abs(p.pp) >= 0.0005 || p.dV > 0)
        .map(p => ({ k: `${p.nm} (+${fmtK(p.dV)} votos)`, v: (p.pp >= 0 ? '+' : '') + dec(p.pp, 3) + ' p.p.', color: areas.find(a => a.id === p.id)?.color }));
      showTip(ev, `${fmtTime(b.t0)}–${fmtTime(b.t1)} (Brasília)`, [...rows, '-', { k: 'Variação líquida no % de Lula', v: (b.pp >= 0 ? '+' : '') + dec(b.pp, 3) + ' p.p.' }, { k: '% de Lula ao final', v: dec(100 * b.s1, 2) + '%' }]);
    };
    g.addEventListener('pointermove', show);
    g.addEventListener('focus', ev => { const r = g.getBoundingClientRect(); show({ clientX: r.right, clientY: r.top }); });
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('blur', hideTip);
  });
}

export const fmtK = v => {
  const a = Math.abs(v);
  return a >= 1e6 ? dec(v / 1e6, a >= 1e8 ? 1 : 2) + ' mi' : a >= 1e3 ? dec(v / 1e3, a >= 1e5 ? 0 : 1) + ' mil' : String(Math.round(v));
};

// ---- Two 100% stacked bars: counted mix vs electorate mix ----
export function mixBars(host, { rows, areas }) {
  host.replaceChildren();
  const W = Math.max(300, host.clientWidth), m = { l: 96, r: 8 }, bh = 22, gap = 18, H = rows.length * (bh + gap) + 6;
  const x = scale(0, 1, m.l, W - m.r);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, host);
  rows.forEach((r, i) => {
    const yy = i * (bh + gap) + 4;
    el('text', { x: 0, y: yy + bh / 2 + 4, class: 'lbl' }, svg, r.nm);
    const tot = r.vals.reduce((s, v) => s + v, 0) || 1;
    let acc = 0;
    r.vals.forEach((v, k) => {
      const f = v / tot;
      if (f <= 0) return;
      const x0 = x(acc), x1 = x(acc + f);
      const g = el('g', {}, svg);
      el('rect', { x: x0 + 1, y: yy, width: Math.max(0.5, x1 - x0 - 2), height: bh, fill: `var(${areas[k].color})`, rx: 2 }, g);
      if (x1 - x0 > 34) el('text', { x: (x0 + x1) / 2, y: yy + bh / 2 + 4, 'text-anchor': 'middle', style: 'fill:#fff;font-weight:600;font-size:11px' }, g, Math.round(100 * f) + '%');
      g.addEventListener('pointermove', ev => showTip(ev, `${areas[k].nm} · ${r.nm}`, [{ k: 'Participação', v: dec(100 * f, 1) + '%', color: areas[k].color }, { k: r.unit, v: fmtK(v) }]));
      g.addEventListener('pointerleave', hideTip);
      acc += f;
    });
  });
}

// ---- Scatter: 1st-round two-party share (x) vs 2nd-round share (y) ----
export function scatter(host, { points, height = 380 }) {
  host.replaceChildren();
  if (!points.length) { h('p', { class: 'note' }, host, 'Nenhum município apurado ainda neste recorte.'); return; }
  const W = Math.max(300, host.clientWidth), H = height, m = { l: 52, r: 12, t: 10, b: 34 };
  const x = scale(0, 100, m.l, W - m.r), y = scale(0, 100, H - m.b, m.t);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, host);
  for (const v of [0, 25, 50, 75, 100]) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }, svg);
    el('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: 'grid' }, svg);
    el('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg, v + '%');
    el('text', { x: x(v), y: H - m.b + 14, class: 'tick', 'text-anchor': 'middle' }, svg, v + '%');
  }
  el('text', { x: (m.l + W - m.r) / 2, y: H - 2, class: 'tick', 'text-anchor': 'middle' }, svg, '% de Lula entre Lula + Flávio, 1º turno');
  el('text', { x: 10, y: (m.t + H - m.b) / 2, class: 'tick', 'text-anchor': 'middle', transform: `rotate(-90 10 ${(m.t + H - m.b) / 2})` }, svg, '% de Lula, 2º turno');
  el('line', { x1: x(0), y1: y(0), x2: x(100), y2: y(100), class: 'ref' }, svg);
  const maxE = Math.max(...points.map(p => p.e));
  const rr = e => Math.max(1.6, 13 * Math.sqrt(e / maxE));
  const g = el('g', {}, svg);
  const sorted = [...points].sort((a, b) => b.e - a.e);
  for (const p of sorted)
    el('circle', { cx: x(p.x), cy: y(p.y), r: rr(p.e), fill: `var(${p.y >= 50 ? '--lula' : '--flavio'})`, 'fill-opacity': 0.55, stroke: 'var(--surface)', 'stroke-width': 1 }, g);
  const ring = el('circle', { r: 6, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, visibility: 'hidden', 'pointer-events': 'none' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: 'hit' }, svg);
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) * W) / r.width, py = ((ev.clientY - r.top) * H) / r.height;
    let best = null, bd = 24 * 24;
    for (const p of sorted) { const d = (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2; if (d < bd) { bd = d; best = p; } }
    if (!best) { hideTip(); ring.setAttribute('visibility', 'hidden'); return; }
    ring.setAttribute('cx', x(best.x)); ring.setAttribute('cy', y(best.y)); ring.setAttribute('r', rr(best.e) + 3); ring.setAttribute('visibility', 'visible');
    showTip(ev, `${best.nm} · ${best.uf.toUpperCase()}`, [
      { k: 'Lula, 2º turno', v: dec(best.y, 1) + '%', color: '--lula' },
      { k: 'Lula/Flávio no 1º turno', v: dec(best.x, 1) + '%' },
      { k: 'Swing', v: (best.y - best.x >= 0 ? 'Lula +' : 'Flávio +') + dec(Math.abs(best.y - best.x), 1) + ' p.p.' },
      '-', { k: 'Apurado', v: dec(best.pct, 0) + '%' }, { k: 'Eleitorado', v: fmtK(best.e) },
    ]);
  });
  hit.addEventListener('pointerleave', () => { hideTip(); ring.setAttribute('visibility', 'hidden'); });
}

// Inline dumbbell for tables: 1st round (hollow) -> 2nd round (filled) on 0-100%.
export function dumbbell(v1, v2, color, w = 100) {
  const s = el('svg', { width: w, height: 16, viewBox: `0 0 ${w} 16` });
  const x = scale(0, 100, 5, w - 5);
  el('line', { x1: x(0), x2: x(100), y1: 8, y2: 8, class: 'grid' }, s);
  el('line', { x1: x(50), x2: x(50), y1: 3, y2: 13, class: 'axis' }, s);
  if (isFinite(v1) && isFinite(v2)) {
    el('line', { x1: x(v1), x2: x(v2), y1: 8, y2: 8, stroke: `var(${color})`, 'stroke-width': 2 }, s);
    el('circle', { cx: x(v1), cy: 8, r: 3.5, fill: 'var(--surface)', stroke: `var(${color})`, 'stroke-width': 1.5 }, s);
    el('circle', { cx: x(v2), cy: 8, r: 4, fill: `var(${color})`, stroke: 'var(--surface)', 'stroke-width': 1.5 }, s);
  }
  return s;
}

// Diverging swing bar: toward Lula grows left (his side of the hero bar), Flávio right.
export function swingBar(pp, max = 5, w = 80) {
  const s = el('svg', { width: w, height: 16, viewBox: `0 0 ${w} 16` });
  const mid = w / 2, k = (w / 2 - 4) / max, len = Math.min(w / 2 - 4, Math.abs(pp) * k);
  el('line', { x1: mid, x2: mid, y1: 1, y2: 15, class: 'axis' }, s);
  if (isFinite(pp) && len > 0.3) el('rect', { x: pp > 0 ? mid - len : mid, y: 4, width: len, height: 8, rx: 2, fill: `var(${pp > 0 ? '--lula' : '--flavio'})` }, s);
  return s;
}
