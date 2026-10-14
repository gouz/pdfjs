// Turns bench/results.csv (from sweep.sh) into bench/chart.svg: req/s vs concurrent users, one line per worker count.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url).pathname;
const rows = readFileSync(dir + 'results.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const vus = [...new Set(rows.map((r) => r[1]))];
const series = [...new Set(rows.map((r) => r[0]))].map((w, i) => ({
  w, cls: `s${i + 1}`, pts: rows.filter((r) => r[0] === w).map((r) => ({ v: r[1], rps: r[2], p95: r[3] })),
}));

const W = 640, H = 340, L = 56, R = 112, T = 48, B = 48;
const max = Math.ceil(Math.max(...rows.map((r) => r[2])) / 250) * 250;
const x = (v) => L + (vus.indexOf(v) * (W - L - R)) / (vus.length - 1);
const y = (rps) => T + (H - T - B) * (1 - rps / max);
const ticks = Array.from({ length: max / 250 + 1 }, (_, i) => i * 250);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" font-family="-apple-system, Segoe UI, Helvetica, sans-serif" font-size="12">
<style>
  .bg{fill:#fcfcfb} .ink{fill:#0b0b0b} .muted{fill:#898781} .grid{stroke:#e1e0d9} .axis{stroke:#c3c2b7}
  .s1{stroke:#2a78d6;fill:#2a78d6} .s2{stroke:#eb6834;fill:#eb6834}
  @media (prefers-color-scheme: dark){
    .bg{fill:#1a1a19} .ink{fill:#f0efec} .grid{stroke:#2c2c2a} .axis{stroke:#383835}
    .s1{stroke:#3987e5;fill:#3987e5} .s2{stroke:#d95926;fill:#d95926}
  }
</style>
<rect class="bg" width="${W}" height="${H}" rx="8"/>
<text class="ink" x="${L}" y="22" font-size="14" font-weight="600">Débit (PDF/s) selon le nombre d'utilisateurs simultanés</text>
${series.map((s, i) => `<g transform="translate(${L + i * 110},34)"><line class="${s.cls}" x1="0" x2="14" y1="0" y2="0" stroke-width="2"/><circle class="${s.cls}" cx="7" r="4"/><text class="muted" x="20" y="4">${s.w} worker${s.w > 1 ? 's' : ''}</text></g>`).join('')}
${ticks.map((t) => `<line class="${t ? 'grid' : 'axis'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="muted" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('\n')}
${vus.map((v) => `<text class="muted" x="${x(v)}" y="${H - B + 18}" text-anchor="middle">${v}</text>`).join('')}
<text class="muted" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">utilisateurs virtuels k6 (VUs)</text>
${series.map((s) => {
  const last = s.pts.at(-1);
  return `<polyline class="${s.cls}" style="fill:none" stroke-width="2" stroke-linejoin="round" points="${s.pts.map((p) => `${x(p.v)},${y(p.rps)}`).join(' ')}"/>
${s.pts.map((p) => `<circle class="${s.cls}" cx="${x(p.v)}" cy="${y(p.rps)}" r="4"><title>${s.w} worker(s), ${p.v} VUs : ${p.rps} PDF/s, p95 ${p.p95} ms</title></circle>`).join('')}
<text class="ink" x="${x(last.v) + 10}" y="${y(last.rps) + 4}">${s.w} worker${s.w > 1 ? 's' : ''} · ${last.rps}/s</text>`;
}).join('\n')}
</svg>
`;
writeFileSync(dir + 'chart.svg', svg);
