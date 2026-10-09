// Signature visuals: form ring, hero constellation, activity heatmap, missions and records.
// Pure functions returning SVG/HTML strings. Every dynamic string goes through esc().
import { esc, pc, portrait, mmss, when } from './ui.js';

// ---------- form ring ----------
/** Radial gauge: current-form win rate as the arc, the all-time rate as a marker. */
export function formRing(form, all) {
  const R = 74, C = 2 * Math.PI * R, wr = Math.max(0, Math.min(1, form.wr || 0)), base = Math.max(0, Math.min(1, all.wr || 0));
  const diff = (wr - base) * 100;
  const ang = base * 2 * Math.PI - Math.PI / 2, mx = 90 + Math.cos(ang) * R, my = 90 + Math.sin(ang) * R;
  return `<div class="ring"><svg viewBox="0 0 180 180" role="img" aria-label="Current form ${pc(wr)}, all time ${pc(base)}">
<defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#45e3ff"/><stop offset=".55" stop-color="#8b7bff"/><stop offset="1" stop-color="#ffcc66"/></linearGradient></defs>
<circle cx="90" cy="90" r="${R}" class="ring-track"/>
<circle cx="90" cy="90" r="${R}" class="ring-arc" stroke="url(#ringg)" stroke-dasharray="${(wr * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 90 90)"/>
<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="5" class="ring-mark"><title>All-time ${pc(base)}</title></circle>
<text x="90" y="86" class="ring-v">${(wr * 100).toFixed(1)}%</text><text x="90" y="108" class="ring-l">CURRENT FORM</text></svg>
<div class="ring-sub"><span class="${diff >= 0 ? 'w' : 'l'}">${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pts</span> vs all-time ${pc(base)}</div></div>`;
}

// ---------- hero constellation ----------
/**
 * Your heroes as stars: further right = more games, higher = better win rate, bigger = more games.
 * Gold lines join your mains. Each star opens the hero page.
 */
export function constellation({ rows, heroes, mains, label }) {
  const pts = rows.filter(r => r.g >= 3); // fewer games are noise (2 games at 100% would stretch the chart)
  if (pts.length < 3) return '<p class="mu">Play a few more heroes to draw your constellation.</p>';
  const W = 1000, H = 380, P = { l: 56, r: 30, t: 30, b: 40 };
  const maxG = Math.max(...pts.map(r => r.g));
  const lo = Math.max(0.15, Math.min(0.3, ...pts.map(r => r.wr))), hi = Math.min(0.9, Math.max(0.75, ...pts.map(r => r.wr)));
  const x = g => P.l + Math.sqrt(g / maxG) * (W - P.l - P.r);
  const y = wr => P.t + (1 - (Math.max(lo, Math.min(hi, wr)) - lo) / (hi - lo)) * (H - P.t - P.b);
  const size = g => 2.6 + 7 * Math.sqrt(g / maxG);
  const tone = wr => (wr >= 0.55 ? 'hot' : wr >= 0.47 ? 'mid' : 'cold');
  const mainSet = new Set(mains);
  const mainPts = pts.filter(r => mainSet.has(r.id)).sort((a, b) => x(a.g) - x(b.g));
  const labelled = new Set([...mainPts.map(r => r.id), ...[...pts].sort((a, b) => b.g - a.g).slice(0, 7).map(r => r.id)]);
  const grid = [0.3, 0.4, 0.5, 0.6, 0.7].filter(v => v >= lo && v <= hi).map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v === 0.5 ? 'cg-mid' : 'cg'}"/><text x="${P.l - 10}" y="${(y(v) + 4).toFixed(1)}" class="cg-t">${Math.round(v * 100)}%</text>`).join('');
  const lines = mainPts.length > 1 ? `<polyline class="c-main" points="${mainPts.map(r => `${x(r.g).toFixed(1)},${y(r.wr).toFixed(1)}`).join(' ')}"/>` : '';
  const stars = pts.map((r, i) => {
    const cx = x(r.g).toFixed(1), cy = y(r.wr).toFixed(1), s = size(r.g), h = heroes[r.id], nm = h ? h.name : 'Hero ' + r.id;
    const main = mainSet.has(r.id);
    return `<a href="#/hero/${r.id}" class="cstar ${tone(r.wr)}${main ? ' main' : ''}" style="--d:${(i % 7) * 0.6}s"><title>${esc(nm)}: ${pc(r.wr)} over ${r.g} recent games</title>
<circle cx="${cx}" cy="${cy}" r="${(s * 3.2).toFixed(1)}" class="halo"/><circle cx="${cx}" cy="${cy}" r="${s.toFixed(1)}" class="core"/>${labelled.has(r.id) ? `<text x="${cx}" y="${(+cy - s - 7).toFixed(1)}" class="c-lbl">${esc(nm)}</text>` : ''}</a>`;
  }).join('');
  return `<div class="constel"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hero constellation: ${pts.length} heroes">
<defs><radialGradient id="halo-hot"><stop offset="0" stop-color="#ffcc66" stop-opacity=".55"/><stop offset="1" stop-color="#ffcc66" stop-opacity="0"/></radialGradient>
<radialGradient id="halo-mid"><stop offset="0" stop-color="#9d8cff" stop-opacity=".5"/><stop offset="1" stop-color="#9d8cff" stop-opacity="0"/></radialGradient>
<radialGradient id="halo-cold"><stop offset="0" stop-color="#ff5c7a" stop-opacity=".45"/><stop offset="1" stop-color="#ff5c7a" stop-opacity="0"/></radialGradient></defs>
${grid}${lines}${stars}
<text x="${W - P.r}" y="${H - 10}" class="cg-t" text-anchor="end">more games →</text></svg></div>
<div class="legend sm mu"><span><i class="lg hot"></i>55%+</span><span><i class="lg mid"></i>47–55%</span><span><i class="lg cold"></i>under 47%</span><span><i class="lg line"></i>your mains</span><span>${esc(label)}</span></div>`;
}

// ---------- activity heatmap ----------
export function heatmap(days) {
  const cell = 14, gap = 4, step = cell + gap;
  const first = days[0].date, offset = (first.getDay() + 6) % 7; // Monday = row 0
  const cols = Math.ceil((days.length + offset) / 7);
  const W = 30 + cols * step, H = 22 + 7 * step;
  let months = '', lastMonth = -1;
  const rects = days.map((d, i) => {
    const idx = i + offset, c = Math.floor(idx / 7), r = idx % 7;
    const x = 30 + c * step, y = 22 + r * step;
    if (d.date.getDate() <= 7 && d.date.getMonth() !== lastMonth && r === 0) { lastMonth = d.date.getMonth(); months += `<text x="${x}" y="12" class="hm-m">${esc(d.date.toLocaleDateString(undefined, { month: 'short' }))}</text>`; }
    const net = d.w - (d.g - d.w);
    const cls = !d.g ? 'z' : net > 0 ? 'p' + Math.min(3, net) : net < 0 ? 'n' + Math.min(3, -net) : 'e';
    const label = `${d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.g ? `${d.w}–${d.g - d.w}` : 'no games'}`;
    return d.g ? `<a href="#/day/${d.key}"><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" class="hm ${cls}"><title>${esc(label)}</title></rect></a>` : `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" class="hm z"><title>${esc(label)}</title></rect>`;
  }).join('');
  const dayLbls = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((t, r) => t ? `<text x="0" y="${22 + r * step + 11}" class="hm-m">${t}</text>` : '').join('');
  const played = days.filter(d => d.g), g = played.reduce((s, d) => s + d.g, 0), w = played.reduce((s, d) => s + d.w, 0);
  return `<div class="heat"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Games per day over the last ${days.length} days">${months}${dayLbls}${rects}</svg></div>
<div class="legend sm mu"><span>${played.length} days played · ${g} games · ${w}–${g - w}</span><span class="grow"></span><span>losing</span><i class="hm-k n2"></i><i class="hm-k n1"></i><i class="hm-k e"></i><i class="hm-k p1"></i><i class="hm-k p2"></i><i class="hm-k p3"></i><span>winning</span></div>`;
}

// ---------- missions ----------
const ICON = { done: '✓', failed: '✕', active: '•', todo: '○' };
export function missionsCard(missions, streak) {
  const core = missions.filter(m => !m.bonus), done = core.filter(m => m.state === 'done').length;
  const anyPlayed = missions.some(m => m.state !== 'todo');
  return `<div class="missions"><div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="margin:0">Today's missions</h2>
<span class="streak${streak ? ' on' : ''}" title="Days in a row with every mission done">${streak ? `${streak}-day streak` : 'No streak yet'}</span></div>
<p class="mu sm" style="margin:4px 0 10px">${anyPlayed ? `${done}/${core.length} done. Checked automatically against today's games.` : 'Checked automatically against the games you play today.'}</p>
<ul class="mlist">${missions.map(m => `<li class="${m.state}${m.bonus ? ' bonus' : ''}"><span class="mi" aria-label="${m.state}">${ICON[m.state]}</span><div><b>${esc(m.title)}</b>${m.bonus ? ' <span class="pill">bonus</span>' : ''}<div class="mu sm">${esc(m.detail)}</div></div></li>`).join('')}</ul></div>`;
}

// ---------- records ----------
export function recordsCard(records, heroes) {
  if (!records.length) return '';
  return `<div class="records">${records.map(r => `<a class="rec" href="#/match/${r.m.id}" title="${esc(heroes[r.m.h] ? heroes[r.m.h].name : '')} · ${esc(when(r.m.t))}">
<span class="rec-v">${esc(String(r.value))}</span><span class="rec-l">${esc(r.label)}</span><span class="rec-h">${portrait(heroes[r.m.h])}<span class="sm mu">${esc(when(r.m.t))} · ${mmss(r.m.d)}</span></span></a>`).join('')}</div>`;
}
