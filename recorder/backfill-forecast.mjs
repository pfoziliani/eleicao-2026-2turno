// Rebuilds the forecast time series (site/data/forecast.json) from the git history of
// site/data/r2-mun.json; incremental, so re-running only adds the newer snapshots.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { forecastPoint, FORECAST_COLS } from '../site/analysis.js';

const OUT = 'site/data/forecast.json';
const r1 = JSON.parse(readFileSync('site/data/r1.json', 'utf8'));
const fc = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { cols: FORECAST_COLS, series: {} };
const lastT = Math.max(0, ...(fc.series.br || []).map(r => r[0]));
const shas = execFileSync('git', ['log', '--reverse', '--format=%H', '--', 'site/data/r2-mun.json']).toString().trim().split('\n');
let added = 0;
for (const sha of shas) {
  const r2 = JSON.parse(execFileSync('git', ['show', `${sha}:site/data/r2-mun.json`], { maxBuffer: 256e6 }).toString());
  const t = Math.floor(Date.parse(r2.updated) / 1000);
  if (!(t > lastT)) continue;
  for (const [sc, v] of Object.entries(forecastPoint(r1, r2))) (fc.series[sc] ||= []).push([t, ...v]);
  added++;
}
for (const sc in fc.series) fc.series[sc].sort((a, b) => a[0] - b[0]);
fc.updated = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(fc));
const br = fc.series.br || [];
console.log('added', added, 'points; br series', br.length, br.slice(0, 2), '...', br.slice(-2));
