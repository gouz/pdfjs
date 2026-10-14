// Turns bench/results.csv (from sweep.sh) into one SVG per metric, x = concurrent users, one line per runtime × worker count.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url).pathname;
const rows = readFileSync(dir + 'results.csv', 'utf8').trim().split('\n').slice(1)
  .map((l) => l.split(',')).map(([rt, ...n]) => [`${rt === 'bun' ? 'Bun' : 'Node'} × ${n[0]}`, ...n.map(Number)]);
// row: [label, workers, vus, req_s, p95_ms, fail_rate, peak_rss_mb]
const vus = [...new Set(rows.map((r) => r[2]))];
const labels = [...new Set(rows.map((r) => r[0]))];
const COLORS = [['#2a78d6', '#3987e5'], ['#eb6834', '#d95926'], ['#1baf7a', '#199e70'], ['#eda100', '#c98500']];

function chart(file, title, col, unit) {
  const series = labels.map((label, i) => ({ label, cls: `s${i + 1}`, pts: rows.filter((r) => r[0] === label).map((r) => ({ v: r[2], val: r[col] })) }));
  const W = 680, H = 360, L = 56, R = 150, T = 56, B = 48;
  const top = Math.max(...rows.map((r) => r[col]));
  const step = [50, 100, 250, 500, 1000, 2500].find((s) => top / s <= 5);
  const max = Math.ceil(top / step) * step;
  const x = (v) => L + (vus.indexOf(v) * (W - L - R)) / (vus.length - 1);
  const y = (val) => T + (H - T - B) * (1 - val / max);
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  // end-of-line labels: sort by height and push apart so they never overlap
  const ends = series.map((s) => ({ s, ly: y(s.pts.at(-1).val) + 4 })).sort((a, b) => a.ly - b.ly);
  ends.forEach((e, i) => { if (i) e.ly = Math.max(e.ly, ends[i - 1].ly + 15); });

  writeFileSync(dir + file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" font-family="-apple-system, Segoe UI, Helvetica, sans-serif" font-size="12">
<style>
  .bg{fill:#fcfcfb} .ink{fill:#0b0b0b} .muted{fill:#898781} .grid{stroke:#e1e0d9} .axis{stroke:#c3c2b7}
  ${COLORS.map(([c], i) => `.s${i + 1}{stroke:${c};fill:${c}}`).join(' ')}
  @media (prefers-color-scheme: dark){
    .bg{fill:#1a1a19} .ink{fill:#f0efec} .grid{stroke:#2c2c2a} .axis{stroke:#383835}
    ${COLORS.map(([, c], i) => `.s${i + 1}{stroke:${c};fill:${c}}`).join(' ')}
  }
</style>
<rect class="bg" width="${W}" height="${H}" rx="8"/>
<text class="ink" x="${L}" y="22" font-size="14" font-weight="600">${title}</text>
${series.map((s, i) => `<g transform="translate(${L + i * 100},38)"><line class="${s.cls}" x1="0" x2="14" y1="0" y2="0" stroke-width="2"/><circle class="${s.cls}" cx="7" r="4"/><text class="muted" x="20" y="4">${s.label}</text></g>`).join('')}
${ticks.map((t) => `<line class="${t ? 'grid' : 'axis'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="muted" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('\n')}
${vus.map((v) => `<text class="muted" x="${x(v)}" y="${H - B + 18}" text-anchor="middle">${v}</text>`).join('')}
<text class="muted" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">utilisateurs virtuels k6 (VUs)</text>
${series.map((s) => `<polyline class="${s.cls}" style="fill:none" stroke-width="2" stroke-linejoin="round" points="${s.pts.map((p) => `${x(p.v)},${y(p.val)}`).join(' ')}"/>
${s.pts.map((p) => `<circle class="${s.cls}" cx="${x(p.v)}" cy="${y(p.val)}" r="4"><title>${s.label}, ${p.v} VUs : ${p.val} ${unit}</title></circle>`).join('')}`).join('\n')}
${ends.map(({ s, ly }) => `<text class="ink" x="${W - R + 10}" y="${ly}">${s.label} · ${s.pts.at(-1).val} ${unit}</text>`).join('\n')}
</svg>
`);
}

chart('chart.svg', "Débit (PDF/s) selon le nombre d'utilisateurs simultanés", 3, 'PDF/s');
chart('memory.svg', "Mémoire max (RSS, Mo) selon le nombre d'utilisateurs simultanés", 6, 'Mo');
