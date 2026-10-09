// Templates for the coaching pages: home dashboard, period breakdowns, Train, and the hero training section.
// Every dynamic string goes through esc().
import { esc, pc, pc1, rankName, heroLink, spark, matchRow } from './ui.js';
import { ytSearch } from './coach.js';
import { ordinal } from './analysis.js';

const sign = (x, d = 0, unit = '') => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d) + unit;
const hours = min => (min >= 90 ? (min / 60).toFixed(1) + ' h' : Math.round(min) + ' min');

function delta(cur, prev, key, { pts = false, lowerBetter = false, d = 0 } = {}) {
  if (!prev || !prev.games || !cur.games || cur[key] == null || prev[key] == null) return '';
  const diff = pts ? (cur[key] - prev[key]) * 100 : cur[key] - prev[key];
  if (Math.abs(diff) < (pts ? 1 : Math.pow(10, -d))) return '<span class="dl mu">±0</span>';
  const good = lowerBetter ? diff < 0 : diff > 0;
  return `<span class="dl ${good ? 'w' : 'l'}">${sign(diff, pts ? 0 : d, pts ? ' pts' : '')}</span>`;
}

// ---------- home ----------
function periodCard(c) {
  const s = c.cur;
  return `<a class="pcard" href="#/period/${c.kind}"><div class="pc-top"><span class="pc-label">${esc(c.label)}</span><span class="pc-go" aria-hidden="true">→</span></div>
${s.games ? `<div class="pc-big"><span class="${s.wr >= 0.5 ? 'w' : 'l'}">${s.wins}–${s.losses}</span> <small>${pc(s.wr)}</small></div>
<div class="pc-sub mu">${s.games} game${s.games === 1 ? '' : 's'} · ${hours(s.minutes)}${c.prev && c.prev.games ? ` · ${delta(s, c.prev, 'wr', { pts: true })} vs ${esc(c.prevLabel.toLowerCase())}` : ''}</div>` : `<div class="pc-big mu">–</div><div class="pc-sub mu">${c.prev && c.prev.games ? `${esc(c.prevLabel)}: ${c.prev.wins}–${c.prev.losses}` : 'No games'}</div>`}
<p class="pc-verdict">${esc(c.verdict)}</p></a>`;
}

const roleBars = roles => `<div class="roles">${roles.roles.filter(r => r.g).map(r => `<div class="role"><div class="row" style="justify-content:space-between"><span>${esc(r.label)}</span><span class="mu sm">${r.g} games</span></div><div class="rbar"><i style="width:${Math.round(r.wr * 100)}%" class="${r.wr >= 0.5 ? 'good' : 'bad'}"></i><span>${pc(r.wr)}</span></div></div>`).join('')}</div>`;

export function dashboard({ account, form, all, cards, strategy, roles, insightsHtml, recsHtml, toTry, heroes, trendsHtml, lastGameHtml, setupHtml, coachTake, roll, ringHtml, missionsHtml, constellationHtml, heatmapHtml, recordsHtml }) {
  account = account || { name: 'Player', rankTier: null, avatar: '' };
  const takeBody = coachTake ? `<div class="take-body">${esc(coachTake.text).split('\n').filter(Boolean).map(l => /^\s*[-*•]\s+/.test(l) ? `<p class="bul">${l.replace(/^\s*[-*•]\s+/, '')}</p>` : `<p>${l}</p>`).join('')}</div><p class="mu sm">Written ${esc(new Date(coachTake.ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))} from your data.</p>` : '<p class="mu" style="margin:10px 0 0">A personal read of where you are and what to do next, written by the AI from your recent games, roles and heroes.</p>';
  return `<section class="hud">
<div class="hud-id card">
  <div class="me">${account.avatar ? `<span class="av-ring"><img class="avatar" src="${esc(account.avatar)}" alt="" width="72" height="72" data-ini="${esc(account.name.slice(0, 1))}"></span>` : ''}<div class="grow"><p class="eyebrow">Commander</p><h1 class="hud-name">${esc(account.name)}</h1><div class="rankline"><span class="rank-badge">${esc(rankName(account.rankTier))}</span><span class="mu sm">${all.games.toLocaleString('en-US')} ranked games</span></div></div></div>
  <div class="hud-stats"><div><span class="num-xl ${form.stats.wr >= 0.5 ? 'w' : 'l'}">${form.stats.wins}–${form.stats.losses}</span><span class="lbl">current form</span></div><div><span class="num-xl">${form.stats.kda.toFixed(1)}</span><span class="lbl">KDA ratio</span></div><div><span class="num-xl">${Math.round(form.stats.gpm || 0)}</span><span class="lbl">GPM</span></div></div>
  ${roll.length > 1 ? `<div class="spark-wrap"><div class="lbl">Rolling 20-game win rate · ${esc(form.label)}</div>${spark(roll, { w: 600, h: 70 })}</div>` : ''}
  ${setupHtml}
</div>
<div class="hud-ring card">${ringHtml}</div>
<div class="hud-missions card">${missionsHtml}</div>
</section>
<div class="pcards">${cards.map(periodCard).join('')}</div>
<div class="grid tri"><section class="card strat"><p class="eyebrow">This week</p><h2>Strategy</h2><p class="headline">${esc(strategy.headline)}</p><dl class="plan-dl">${strategy.points.map(p => `<dt>${esc(p.k)}</dt><dd>${esc(p.v)}</dd>`).join('')}</dl><p class="sm" style="margin:12px 0 0"><a href="#/train">Open your training plan →</a></p></section>
<section class="card"><p class="eyebrow">Queue</p><h2>Which role</h2>${roles.advice.role ? `<p class="headline">${esc(roles.advice.text)}</p>${roles.advice.sub ? `<p class="sm">${esc(roles.advice.sub)}</p>` : ''}` : `<p class="mu">${esc(roles.advice.text)}</p>`}${roleBars(roles)}<p class="mu sm" style="margin:10px 0 0">Estimated from your last hits per minute over your ${esc(form.label)}.</p></section>
<section class="card take"><p class="eyebrow">AI</p><div class="row" style="justify-content:space-between"><h2 style="margin:0">Coach's take</h2><button class="pri sm-btn" data-act="coach-take">${coachTake ? 'Refresh' : 'Generate'}</button></div>${takeBody}</section></div>
<section class="card constel-card"><div class="row" style="justify-content:space-between;align-items:baseline"><div><p class="eyebrow">Your hero pool</p><h2 style="margin:0">Constellation</h2></div><a class="sm" href="#/heroes">All heroes →</a></div>${constellationHtml}</section>
<div class="grid two"><section class="card"><p class="eyebrow">Last 26 weeks</p><h2>Activity</h2>${heatmapHtml}<p class="mu sm" style="margin:8px 0 0">Click a day to open its breakdown.</p></section><section class="card"><p class="eyebrow">All time</p><h2>Personal records</h2>${recordsHtml}</section></div>
${insightsHtml}
<div class="grid two" style="margin-top:18px"><div>${recsHtml}${toTry.length ? `<section class="card" style="margin-top:18px"><p class="eyebrow">Expand your pool</p><h2>Heroes to try</h2><ul class="recs">${toTry.map(t => `<li><div class="row" style="justify-content:space-between"><b>${heroLink(heroes[t.id], t.id)}</b><a class="sm" href="#/hero/${t.id}">Training plan →</a></div><ul class="ev">${t.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></li>`).join('')}</ul></section>` : ''}</div><div>${trendsHtml}${lastGameHtml}</div></div>`;
}

// ---------- period breakdown ----------
const TITLES = { day: 'Today', week: 'This week', month: 'This month', year: 'This year', all: 'All time' };
const statTile = (label, value, d = '') => `<div class="tile"><div class="mu sm">${esc(label)}</div><div class="tv">${value}</div>${d ? `<div class="sm">${d}</div>` : ''}</div>`;

export function periodPage({ kind, s, prev, prevLabel, range, list, heroes, verdict, insights, notesBest, notesWorst, roles, breakdown, shown, title: customTitle }) {
  const title = customTitle || TITLES[kind] || 'Period';
  const from = range.start && !customTitle ? new Date(range.start * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;
  const nav = ['day', 'week', 'month', 'year', 'all'].map(k => `<a href="#/period/${k}"${k === kind ? ' aria-current="page"' : ''}>${TITLES[k]}</a>`).join('');
  if (!s.games) {
    return `<p><a href="#/">← Coach</a></p><nav class="subnav" aria-label="Periods">${nav}</nav><h1>${title}</h1><div class="card empty"><h2>No ranked games ${kind === 'day' ? 'today' : 'in this period'}</h2><p>${prev && prev.games ? `${esc(prevLabel)}: ${prev.wins}–${prev.losses} (${pc(prev.wr)}).` : ''} Play a game, then sync, and your breakdown appears here.</p></div>`;
  }
  const game = (m, n, label) => m ? `<section class="card"><h2>${label}</h2>${matchRow(m)}${n.length ? `<ul class="notes">${n.map(x => `<li class="${x.tone}"><span aria-hidden="true">${x.tone === 'good' ? '▲' : x.tone === 'bad' ? '▼' : '•'}</span> ${esc(x.text)}</li>`).join('')}</ul>` : ''}</section>` : '';
  return `<p><a href="#/">← Coach</a></p><nav class="subnav" aria-label="Periods">${nav}</nav>
<div class="row" style="justify-content:space-between;align-items:flex-end"><div><h1>${title}</h1><p class="mu" style="margin:0 0 14px">${from ? 'Since ' + esc(from) + ' · ' : ''}${s.games} ranked game${s.games === 1 ? '' : 's'}${prev && prev.games ? ` · compared with ${esc(prevLabel.toLowerCase())}` : ''}</p></div>
<button class="pri" data-act="period-review" data-kind="${kind}" data-title="${esc(title)}">Coach review of ${esc(title.toLowerCase())}</button></div>
<div class="tiles">${statTile('Record', `<span class="${s.wr >= 0.5 ? 'w' : 'l'}">${s.wins}–${s.losses}</span>`, delta(s, prev, 'wr', { pts: true }) ? `win rate ${pc(s.wr)} ${delta(s, prev, 'wr', { pts: true })}` : `win rate ${pc(s.wr)}`)}
${statTile('Time played', hours(s.minutes))}
${statTile('Average KDA', `${s.k.toFixed(1)}/${s.de.toFixed(1)}/${s.a.toFixed(1)}`, delta(s, prev, 'kda', { d: 1 }) ? `ratio ${s.kda.toFixed(1)} ${delta(s, prev, 'kda', { d: 1 })}` : `ratio ${s.kda.toFixed(1)}`)}
${statTile('GPM', s.gpm ? Math.round(s.gpm) : '–', delta(s, prev, 'gpm'))}
${statTile('Deaths per minute', s.dpm ? s.dpm.toFixed(2) : '–', delta(s, prev, 'dpm', { lowerBetter: true, d: 2 }))}
${statTile('Current streak', `${s.streak.n} ${s.streak.won ? 'W' : 'L'}`)}</div>
<div class="grid two"><section class="card"><h2>Coach's verdict</h2><p class="headline">${esc(verdict)}</p>${insights}</section>
<section class="card"><h2>Heroes played</h2><div class="tw"><table><thead><tr><th>Hero</th><th class="num">Games</th><th class="num">W–L</th><th class="num">Win rate</th></tr></thead><tbody>${s.heroes.slice(0, 10).map(h => `<tr><td>${heroLink(heroes[h.id], h.id)}</td><td class="num">${h.g}</td><td class="num">${h.w}–${h.g - h.w}</td><td class="num">${pc(h.w / h.g)}</td></tr>`).join('')}</tbody></table></div>
${roles.roles.some(r => r.g) ? `<h3 style="margin-top:14px">Roles (estimated)</h3>${roleBars(roles)}` : ''}</section></div>
${breakdown.length > 1 ? `<section class="card" style="margin-top:18px"><h2>Breakdown</h2><div class="tw"><table><thead><tr><th>${kind === 'week' || kind === 'month' ? 'Day' : kind === 'year' ? 'Month' : 'Year'}</th><th class="num">Games</th><th class="num">W–L</th><th class="num">Win rate</th><th></th></tr></thead><tbody>${breakdown.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${b.g}</td><td class="num">${b.w}–${b.g - b.w}</td><td class="num">${pc(b.w / b.g)}</td><td><span class="bar" aria-hidden="true"><i style="width:${Math.round(b.w / b.g * 100)}%"></i></span></td></tr>`).join('')}</tbody></table></div></section>` : ''}
<div class="grid two" style="margin-top:18px">${game(s.best, notesBest, 'Best game')}${s.games > 1 ? game(s.worst, notesWorst, 'Toughest game') : ''}</div>
<section class="card" style="margin-top:18px"><h2>Games</h2>${list.slice(0, shown).map(matchRow).join('')}${shown < list.length ? `<div class="row" style="margin-top:14px;justify-content:center"><button data-act="period-more">Show more (${list.length - shown} left)</button></div>` : ''}</section>`;
}

// ---------- train ----------
const guideCard = (g, mine) => `<section class="card guide${mine ? ' mine' : ''}"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(g.title)}</h3>${mine ? '<span class="pill focus">For you</span>' : ''}</div>
<p class="mu sm">${esc(g.why)}</p><details${mine ? ' open' : ''}><summary>Steps and drill</summary><ol class="ev">${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><p class="kv"><b>Drill:</b> ${esc(g.drill)}</p></details>
<div class="vids">${g.watch.map(q => `<a class="vid" href="${esc(ytSearch(q))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span> ${esc(q)}</a>`).join('')}</div></section>`;

export function trainPage({ strategy, drills, guides, myAreas, mains, toTry, heroes, form }) {
  return `<h1>Train</h1><p class="mu" style="margin:0 0 18px">Your plan for this week, built from your ${esc(form.label)}, plus guides and videos for the areas that matter most for you. Guides are coaching methods; numbers come from your games.</p>
<div class="grid two"><section class="card strat"><h2>This week</h2><p class="headline">${esc(strategy.headline)}</p><dl class="plan-dl">${strategy.points.map(p => `<dt>${esc(p.k)}</dt><dd>${esc(p.v)}</dd>`).join('')}</dl></section>
<section class="card"><h2>Drills from your plan</h2>${drills.length ? `<ol class="ev">${drills.map(d => `<li><b>${esc(d.title)}.</b> ${esc(d.drill)}${d.target ? ` <span class="mu">Target: ${esc(d.target)}</span>` : ''}</li>`).join('')}</ol>` : '<p class="mu">No clear weaknesses right now. Keep your hero pool tight and review losses.</p>'}</section></div>
<div class="grid two" style="margin-top:18px"><section class="card"><h2>Your main heroes</h2>${mains.length ? `<ul class="recs">${mains.map(r => `<li><div class="row" style="justify-content:space-between"><b>${heroLink(heroes[r.id], r.id)}</b><a class="sm" href="#/hero/${r.id}">Training plan →</a></div><p class="mu sm" style="margin:4px 0 0">${pc(r.wr)} over ${r.g} recent games</p></li>`).join('')}</ul>` : '<p class="mu">Play more games to find your mains.</p>'}</section>
<section class="card"><h2>Heroes to learn</h2>${toTry.length ? `<ul class="recs">${toTry.map(t => `<li><div class="row" style="justify-content:space-between"><b>${heroLink(heroes[t.id], t.id)}</b><a class="sm" href="#/hero/${t.id}">Training plan →</a></div><p class="mu sm" style="margin:4px 0 0">${esc(t.reasons[0])}</p></li>`).join('')}</ul><p class="mu sm">Learn new heroes in unranked or Turbo until you have about 10 games on them.</p>` : '<p class="mu">No suggestions yet.</p>'}</section></div>
<h2 style="margin:26px 0 12px">Guides</h2><div class="guides">${guides.map(g => guideCard(g, myAreas.includes(g.area))).join('')}</div>`;
}

// ---------- hero training section (hero page) ----------
export function heroTraining({ hero, targets, build, drills, loading }) {
  const name = hero.name;
  const vids = [`${name} guide dota 2`, `${name} pro gameplay dota 2`, `${name} laning tips dota 2`, `how to play ${name} dota 2 build`];
  return `<section class="card" style="margin-top:18px"><h2>Train ${esc(name)}</h2>
${loading ? '<div class="skel"></div><div class="skel"></div>' : ''}
${targets.length ? `<h3>Your targets</h3><div class="tw"><table><thead><tr><th>Stat</th><th class="num">You (recent)</th><th class="num">Percentile</th><th class="num">Target</th></tr></thead><tbody>${targets.map(t => `<tr><td>${esc(t.label)}</td><td class="num">${t.you}</td><td class="num">${ordinal(Math.round(t.pct * 100))}</td><td class="num"><b>${t.target}</b> <span class="mu sm">(${ordinal(Math.round(t.targetPct * 100))})</span></td></tr>`).join('')}</tbody></table></div><p class="mu sm">Percentiles from OpenDota's ${esc(name)} benchmarks across all ranks.</p>` : (loading ? '' : '<p class="mu">Play a few games on this hero to get personal targets.</p>')}
${build.length ? `<h3 style="margin-top:16px">Popular build</h3><div class="build">${build.map(p => `<div class="phase"><div class="mu sm">${esc(p.label)}</div><div class="items">${p.items.map(i => `<span class="item" title="${esc(i.name)}${i.cost ? ' · ' + i.cost + ' gold' : ''}">${i.img ? `<img src="https://cdn.cloudflare.steamstatic.com${esc(i.img.replace(/\?.*$/, ''))}" alt="" width="44" height="32" loading="lazy" data-ini="${esc(i.name.slice(0, 2))}">` : ''}<span>${esc(i.name)}</span></span>`).join('')}</div></div>`).join('')}</div><p class="mu sm">Most-bought items on ${esc(name)} in recent public matches (all ranks). Adapt to the game.</p>` : ''}
${drills.length ? `<h3 style="margin-top:16px">How to practise</h3><ol class="ev">${drills.map(d => `<li>${esc(d)}</li>`).join('')}</ol>` : ''}
<h3 style="margin-top:16px">Watch</h3><div class="vids">${vids.map(q => `<a class="vid" href="${esc(ytSearch(q))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span> ${esc(q)}</a>`).join('')}</div></section>`;
}

