// Cloud version of the recorder + aggregator, meant to run inside GitHub Actions.
// Seeds itself from the data already published in site/data, keeps polling TSE,
// commits the refreshed files and asks the Pages workflow to redeploy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { R2, uUrl, abUrl, getJSON, extract, pool } from './tse.mjs';
import { forecastPoint, FORECAST_COLS } from '../site/analysis.js';

const DATA = 'site/data';
const UFS = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to', 'zz'];
const STOP_AFTER = Date.parse('2026-10-26T15:00:00Z');
const MAX_RUN = Number(process.env.MAX_RUN_MIN || 340) * 60e3;
const STATE_EVERY = 20e3, MUN_EVERY = 40e3, PUSH_EVERY = 110e3;
const started = Date.now();

const read = (f, fb) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fb);
const tl = read(`${DATA}/timeline.json`, { series: {} });
const series = tl.series;
const r2 = read(`${DATA}/r2-mun.json`, { rows: {} });
const mun = r2.rows;
const r1 = read(`${DATA}/r1.json`, null);
const fc = read(`${DATA}/forecast.json`, { cols: FORECAST_COLS, series: {} });
const R2_COLS = ['st', 'ts', 'est', 'te', 'c', 'a', 'vb', 'vn', 'v13', 'v22', 't0', 't1'];
let munDirty = false;
const brt = (d, h) => { const [D, M, Y] = d.split('/').map(Number); const [hh, mm, ss] = h.split(':').map(Number); return Date.UTC(Y, M - 1, D, hh + 3, mm, ss) / 1000; };
let lastChange = 0, complete = false;

async function pollStates() {
  const res = await Promise.allSettled(UFS.map(uf => getJSON(uUrl(R2, uf))));
  let done = 0;
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const j = r.value, x = extract(j), uf = UFS[i];
    if (x.ts && x.st >= x.ts) done++;
    const row = [brt(j.dg, j.hg), x.st, x.ts, x.est, x.te, x.c, x.a, x.vb, x.vn, x.cand['13'] || 0, x.cand['22'] || 0];
    const s = (series[uf] ||= []);
    const prev = s[s.length - 1];
    if (prev && prev[1] === row[1] && prev[5] === row[5]) return;
    if (prev && row[0] < prev[0]) return;
    lastChange = Date.now();
    // At most one row per area per minute (the latest), same as the local aggregator.
    if (prev && Math.floor(prev[0] / 60) === Math.floor(row[0] / 60)) s[s.length - 1] = row; else s.push(row);
  });
  complete = done === UFS.length;
}

async function pollMunicipalities() {
  const abs = await pool(UFS, 8, uf => getJSON(abUrl(R2, uf)).catch(() => null));
  const todo = [];
  abs.forEach((ab, i) => {
    if (!ab) return;
    for (const m of ab.abr) {
      if (m.tpabr !== 'mun' || !(Number(m.s.st) > 0)) continue;
      const key = UFS[i] + m.cdabr, row = mun[key];
      if (!row || row[0] !== Number(m.s.st) || row[4] !== Number(m.e.c)) todo.push([key, UFS[i], m.cdabr]);
    }
  });
  await pool(todo, 24, async ([key, uf, cd]) => {
    try {
      const j = await getJSON(uUrl(R2, uf, cd));
      if (!j) return;
      const r = extract(j), old = mun[key], now = Math.floor(Date.now() / 1000);
      mun[key] = [r.st, r.ts, r.est, r.te, r.c, r.a, r.vb, r.vn, r.cand['13'] || 0, r.cand['22'] || 0,
        old?.[10] ?? now, r.ts > 0 && r.st >= r.ts ? (old?.[11] || now) : 0];
      munDirty = true;
    } catch (e) { console.error(e.message); }
  });
  return todo.length;
}

function publish() {
  const updated = new Date().toISOString();
  // One forecast point per publish in which municipality data moved.
  if (munDirty && r1) {
    try {
      const t = Math.floor(Date.parse(updated) / 1000);
      for (const [sc, v] of Object.entries(forecastPoint(r1, { cols: R2_COLS, rows: mun }))) (fc.series[sc] ||= []).push([t, ...v]);
      fc.updated = updated;
      writeFileSync(`${DATA}/forecast.json`, JSON.stringify(fc));
    } catch (e) { console.error('forecast failed', e.message); }
    munDirty = false;
  }
  writeFileSync(`${DATA}/r2-mun.json`, JSON.stringify({ updated, cols: R2_COLS, rows: mun }));
  writeFileSync(`${DATA}/timeline.json`, JSON.stringify({ updated, cols: ['t', 'st', 'ts', 'est', 'te', 'c', 'a', 'vb', 'vn', 'v13', 'v22'], series }));
  const git = (...a) => execFileSync('git', a, { timeout: 90e3, stdio: 'pipe' }).toString();
  git('add', DATA);
  if (!git('status', '--porcelain', DATA).trim()) return false;
  git('commit', '-q', '-m', `data ${updated} (cloud)`);
  try { git('push', '-q'); } catch {
    // Someone else pushed (e.g. a code change): keep our data files on rebase.
    git('pull', '-q', '--rebase', '-X', 'theirs');
    git('push', '-q');
  }
  return true;
}

async function redeploy() {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/pages.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!r.ok) console.error('dispatch failed', r.status, await r.text());
}

if (Date.now() > STOP_AFTER) {
  // Election night is over: switch the schedule off so it stops waking up.
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/live.yml/disable`, {
    method: 'PUT', headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  console.log('past the counting window; disabled schedule:', r.status);
  process.exit(0);
}
await pollStates();
if (complete && !lastChange) { console.log('count already complete and published'); process.exit(0); }
lastChange = Date.now();

let lastState = Date.now(), lastMun = 0, lastPush = 0;
while (Date.now() - started < MAX_RUN) {
  const now = Date.now();
  try {
    if (now - lastState >= STATE_EVERY) { lastState = now; await pollStates(); }
    if (now - lastMun >= MUN_EVERY) { lastMun = now; const n = await pollMunicipalities(); console.log(new Date().toISOString(), 'municipalities refreshed', n, 'total', Object.keys(mun).length); }
    if (now - lastPush >= PUSH_EVERY) {
      lastPush = now;
      if (publish()) { await redeploy(); console.log('  published'); }
    }
  } catch (e) { console.error('cycle error', e.message); }
  // Count finished and nothing moved for 15 min: publish once more and stop.
  if (complete && Date.now() - lastChange > 15 * 60e3) { if (publish()) await redeploy(); console.log('count complete, exiting'); break; }
  await new Promise(r => setTimeout(r, 2000));
}
