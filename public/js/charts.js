// Lightweight SVG charts (line/area, bar/stacked bar, donut) with hover tooltips.
import { html, raw, esc } from './lib.js';

export const COLORS = { present: '#12a150', absent: '#e5484d', late: '#d97706', half_day: '#7c3aed', primary: '#2f5bea', sky: '#87cefa', muted: '#cfd6e3' };

let tip;
function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div'); tip.className = 'chart-tip hidden'; document.body.appendChild(tip);
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.classList.add('hidden'); return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.classList.remove('hidden');
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - w - 8)}px`;
    tip.style.top = `${e.clientY - 36}px`;
  });
  return tip;
}

/** Line / area chart. data: [{label, value, tip?}] */
export function lineChart(data, { height = 220, color = COLORS.primary, min = 0, max = 100, suffix = '%', area = true } = {}) {
  ensureTip();
  if (!data.length) return html`<div class="empty small">No data yet</div>`;
  const W = 640, H = height, pl = 36, pr = 10, pt = 12, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const lo = Math.min(min, ...data.map((d) => d.value));
  const hi = Math.max(max, ...data.map((d) => d.value));
  const x = (i) => pl + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pt + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) / ticks) * i);
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  const step = Math.ceil(data.length / 8);
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  return html`<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".18"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${grid.map((g) => raw(`<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}"/>`))}</g>
    <g class="axis">${grid.map((g) => raw(`<text x="${pl - 6}" y="${y(g) + 4}" text-anchor="end">${Math.round(g)}${esc(suffix)}</text>`))}
      ${data.map((d, i) => (i % step === 0 || i === data.length - 1 ? raw(`<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`) : ''))}</g>
    ${area ? raw(`<path d="M${pts[0]} L${pts.join(' L')} L${x(data.length - 1)},${pt + ih} L${x(0)},${pt + ih} Z" fill="url(#${id})"/>`) : ''}
    ${raw(`<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)}
    ${data.map((d, i) => raw(`<circle cx="${x(i)}" cy="${y(d.value)}" r="${data.length > 40 ? 2 : 3.5}" fill="#fff" stroke="${color}" stroke-width="2"/><rect x="${x(i) - iw / data.length / 2}" y="${pt}" width="${iw / data.length}" height="${ih}" fill="transparent" data-tip="${esc(d.tip || `${d.label}: ${d.value}${suffix}`)}"/>`))}
  </svg></div>`;
}

/** Stacked/grouped bar chart. data: [{label, values: {key: n}}], series: [{key, label, color}] */
export function barChart(data, series, { height = 240, stacked = true, suffix = '' } = {}) {
  ensureTip();
  if (!data.length) return html`<div class="empty small">No data yet</div>`;
  const W = 640, H = height, pl = 34, pr = 8, pt = 10, pb = 28;
  const iw = W - pl - pr, ih = H - pt - pb;
  const totals = data.map((d) => (stacked ? series.reduce((a, s) => a + (d.values[s.key] || 0), 0) : Math.max(...series.map((s) => d.values[s.key] || 0))));
  const max = Math.max(1, ...totals);
  const nice = Math.ceil(max / 5) * 5 || 5;
  const bw = iw / data.length;
  const barW = Math.min(36, bw * 0.62);
  const y = (v) => (v / nice) * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const bars = data.map((d, i) => {
    const cx = pl + bw * i + bw / 2;
    if (stacked) {
      let acc = 0;
      return series.map((s) => {
        const v = d.values[s.key] || 0; if (!v) return '';
        const h = y(v); const top = pt + ih - y(acc) - h; acc += v;
        return `<rect x="${cx - barW / 2}" y="${top}" width="${barW}" height="${Math.max(h, 0.5)}" fill="${s.color}" rx="2" data-tip="${esc(`${d.label} — ${s.label}: ${v}${suffix}`)}"/>`;
      }).join('');
    }
    const gw = barW / series.length;
    return series.map((s, k) => { const v = d.values[s.key] || 0; const h = y(v); return `<rect x="${cx - barW / 2 + k * gw}" y="${pt + ih - h}" width="${gw - 2}" height="${Math.max(h, 0.5)}" fill="${s.color}" rx="3" data-tip="${esc(`${d.label} — ${s.label}: ${v}${suffix}`)}"/>`; }).join('');
  });
  return html`<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
    <g class="grid">${grid.map((g) => raw(`<line x1="${pl}" x2="${W - pr}" y1="${pt + ih - y(g)}" y2="${pt + ih - y(g)}"/>`))}</g>
    <g class="axis">${grid.map((g) => raw(`<text x="${pl - 6}" y="${pt + ih - y(g) + 4}" text-anchor="end">${Math.round(g)}</text>`))}
    ${data.map((d, i) => raw(`<text x="${pl + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`))}</g>
    ${raw(bars.join(''))}
  </svg></div>
  <div class="legend mt-8">${series.map((s) => html`<span><i style="background:${s.color}"></i>${s.label}</span>`)}</div>`;
}

/** Donut. segments: [{label, value, color}] */
export function donut(segments, { size = 150, center, sub } = {}) {
  ensureTip();
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 54, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = total ? segments.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const el = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)" data-tip="${esc(`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`)}"/>`;
    off += len; return el;
  }).join('') : `<circle r="${r}" cx="70" cy="70" fill="none" stroke="#eef1f6" stroke-width="18"/>`;
  return html`<div class="donut-wrap">
    <svg viewBox="0 0 140 140" width="${size}" height="${size}" style="flex:none">${raw(arcs)}
      <text x="70" y="${sub ? 68 : 76}" text-anchor="middle" font-size="22" font-weight="700" fill="#0f1b33">${center ?? total}</text>
      ${sub ? raw(`<text x="70" y="88" text-anchor="middle" font-size="10.5" fill="#7b879e">${esc(sub)}</text>`) : ''}</svg>
    <div class="donut-legend">${segments.map((s) => html`<div class="lg"><i style="background:${s.color}"></i>${s.label}<b>${s.value}</b></div>`)}</div>
  </div>`;
}

export const progress = (value, color) => html`<div class="progress"><div style="width:${Math.max(0, Math.min(100, value))}%;${color ? `background:${color}` : ''}"></div></div>`;
export const pctColor = (p) => (p >= 90 ? COLORS.present : p >= 75 ? COLORS.primary : p >= 60 ? COLORS.late : COLORS.absent);
