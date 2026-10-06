// View templates. Every dynamic string goes through esc(); views return HTML strings.
import { won, rollingWR, ordinal } from './analysis.js';
import { heroImg, heroIcon } from './api.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pc = x => (x * 100).toFixed(0) + '%';
export const pc1 = x => (x * 100).toFixed(1) + '%';
export const mmss = s => { const t = Math.max(0, Math.floor(s)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
export const when = t => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const RANKS = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];
export const rankName = rt => (rt ? RANKS[Math.min(8, Math.floor(rt / 10))] + (rt % 10 ? ' ' + (rt % 10) : '') : 'Unranked');

export const NAV = [['#/', 'Coach'], ['#/draft', 'Draft'], ['#/live', 'Live'], ['#/heroes', 'Heroes'], ['#/matches', 'Matches'], ['#/prefs', 'Preferences']];

export function nav(route) {
  // A single hero or match page belongs to its list section in the nav.
  const section = route.startsWith('/hero/') ? '/heroes' : route.startsWith('/match/') ? '/matches' : route;
  return NAV.map(([h, l]) => `<a href="${h}"${(h === '#/' ? section === '/' : section.startsWith(h.slice(1))) ? ' aria-current="page"' : ''}>${l}</a>`).join('');
}

/** Portrait with graceful fallback (see the delegated error handler in main.js). */
export function portrait(hero, { icon = true, big = false } = {}) {
  const name = hero ? hero.name : '?';
  const src = hero ? (big ? heroImg(hero) : icon ? heroImg(hero) : heroIcon(hero)) : '';
  const ini = esc(name.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2));
  return src
    ? `<img class="hp${big ? ' lg' : ''}" src="${esc(src)}" alt="" width="${big ? 128 : 46}" height="${big ? 72 : 26}" loading="lazy" data-ini="${ini}">`
    : `<span class="hp fb${big ? ' lg' : ''}">${ini}</span>`;
}
// Favourite and avoided markers wherever a hero is shown, so Preferences are visible across the site.
let _prefs = { favorites: [], avoided: [] };
export const setPrefs = p => { _prefs = p; };
const prefMark = id => (_prefs.favorites.includes(id) ? '<span class="mark fav" title="Favourite" aria-label="favourite">★</span>' : _prefs.avoided.includes(id) ? '<span class="mark avoid" title="Avoided" aria-label="avoided">⊘</span>' : '');
export const heroLink = (hero, id) => `<a class="hero" href="#/hero/${id}">${portrait(hero)}<span>${esc(hero ? hero.name : 'Hero ' + id)}${prefMark(id)}</span></a>`;

export const skeleton = () => '<div class="skel h"></div><div class="skel"></div><div class="skel"></div><div class="skel h"></div>';

export function notice(kind, html) { return `<div class="notice ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${html}</div>`; }

/** Inline SVG sparkline with a 50% reference line. */
export function spark(values, { w = 600, h = 100 } = {}) {
  if (values.length < 2) return '';
  const lo = Math.min(0.25, ...values), hi = Math.max(0.75, ...values);
  const x = i => (i / (values.length - 1)) * (w - 8) + 4;
  const y = v => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Rolling win rate over the last ${values.length} windows, now ${pc(last)}" preserveAspectRatio="none">
<line x1="0" x2="${w}" y1="${y(0.5)}" y2="${y(0.5)}" stroke="rgba(150,160,255,.35)" stroke-dasharray="4 5"/>
<polygon points="${x(0)},${h} ${pts} ${x(values.length - 1)},${h}" fill="rgba(139,123,255,.18)"/>
<polyline points="${pts}" fill="none" stroke="#8b7bff" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
<circle cx="${x(values.length - 1)}" cy="${y(last)}" r="4.5" fill="#f4c76b"/></svg>`;
}

/** Two-series area chart centred on zero (gold / XP advantage). */
export function advChart(series, { w = 600, h = 140, label = '' } = {}) {
  if (!series || series.length < 2) return '';
  const m = Math.max(1, ...series.map(Math.abs));
  const x = i => (i / (series.length - 1)) * w, y = v => h / 2 - (v / m) * (h / 2 - 8);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
<line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="rgba(150,160,255,.4)"/>
<polygon points="0,${h / 2} ${pts} ${w},${h / 2}" fill="rgba(95,212,232,.18)"/>
<polyline points="${pts}" fill="none" stroke="#5fd4e8" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>`;
}

function deathTimeline(times, duration) {
  const w = 600, h = 44;
  const ticks = times.map(t => `<line x1="${(t / duration * (w - 8) + 4).toFixed(1)}" x2="${(t / duration * (w - 8) + 4).toFixed(1)}" y1="8" y2="${h - 14}" stroke="#ff7f98" stroke-width="3" stroke-linecap="round"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Your ${times.length} deaths across the match" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${h - 14}" y2="${h - 14}" stroke="rgba(150,160,255,.4)"/>${ticks}<text x="4" y="${h - 1}" fill="#a3a9d6" font-size="11">0:00</text><text x="${w - 4}" y="${h - 1}" fill="#a3a9d6" font-size="11" text-anchor="end">${mmss(duration)}</text></svg>`;
}

// ---------- onboarding ----------
export function onboarding({ error = '', preview = null, busy = false, value = '' } = {}) {
  const star = '<svg width="64" height="64" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4c76b"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs><path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z" fill="url(#g2)"/></svg>';
  let card;
  if (preview) {
    const st = preview.state;
    const msg = st === 'private' ? notice('err', '<b>No match data is visible.</b> In Dota 2 go to Settings → Options → Social and turn on <b>Expose Public Match Data</b>, play or wait a few minutes, then try again.')
      : st === 'noranked' ? notice('err', `<b>No ranked games found.</b> This account has ${preview.allGames} games but none in ranked matchmaking. Astra studies ranked only. Play some ranked games and come back.`)
        : '';
    card = `<div class="card"><div class="me"><img class="avatar" src="${esc(preview.avatar)}" alt="" width="64" height="64" data-ini="${esc(preview.name.slice(0, 1))}"><div><h2 style="margin:0">${esc(preview.name)}</h2><div class="mu">${esc(rankName(preview.rankTier))} · ${preview.rankedGames} ranked games</div></div></div>
${msg}<div class="row" style="margin-top:16px"><button class="pri" data-act="confirm" ${st !== 'ok' || busy ? 'disabled' : ''}>${busy ? 'Syncing…' : 'Sync my ranked games'}</button><button class="ghost" data-act="reset">Not me</button></div></div>`;
  } else {
    card = `<form class="card" data-form="lookup"><label class="f" for="pid" style="margin-top:0">Your Dota 2 player ID or profile link</label>
<div class="row"><input id="pid" name="pid" class="grow" inputmode="text" autocomplete="off" placeholder="e.g. 258651500 or opendota.com/players/…" value="${esc(value)}" aria-describedby="pid-help"><button class="pri" ${busy ? 'disabled' : ''}>${busy ? 'Looking…' : 'Find me'}</button></div>
<p id="pid-help" class="mu sm" style="margin:10px 0 0">Find it in the Dota 2 client (your profile) or on opendota.com. Accepts the 32-bit ID, a 64-bit Steam ID or a profile link.</p>
${error ? `<p class="err-line" role="alert">${esc(error)}</p>` : ''}</form>`;
  }
  return `<div class="onb"><div class="hero-welcome">${star}<h1>Astra</h1><p class="mu" style="margin:0 0 18px">Your ranked Dota coach. It studies your public match history after games and tells you what to fix. Nothing touches the game client.</p></div>${card}</div>`;
}

// ---------- coach home ----------
const planItem = (i, n) => `<li><span class="rank" aria-hidden="true">${n}</span><div><h3>${esc(i.title)} ${i.pinned ? '<span class="pill focus">Your focus</span> ' : ''}<span class="pill ${i.conf}" title="Based on ${i.n} games">${i.conf} confidence · ${i.n} games</span></h3>
<ul class="ev">${i.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
${i.why ? `<p class="mu sm" style="margin:6px 0">${esc(i.why)}</p>` : ''}
${i.drill ? `<p class="kv"><b>Drill:</b> ${esc(i.drill)}</p>` : ''}${i.target ? `<p class="kv"><b>Target:</b> ${esc(i.target)}</p>` : ''}</div></li>`;

/** Auto-scaled sparkline for small trend tiles. */
function miniSpark(values, color) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return '';
  const w = 160, h = 38, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * (w - 6) + 3).toFixed(1)},${(h - 4 - ((x - lo) / span) * (h - 8)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" class="mini" aria-hidden="true" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

const CHANGE = { better: ['Improving', 'w', '#58d6a0'], worse: ['Getting worse', 'l', '#ff7f98'], flat: ['Steady', 'mu', '#8b7bff'] };
const trendsCard = trends => trends.length ? `<section class="card"><h2>Trends</h2><p class="mu sm" style="margin:-6px 0 12px">Last 30 ranked games against the 30 before.</p><div class="trends">${trends.map(t => {
  const [label, cls, col] = CHANGE[t.change];
  return `<div class="trend"><div class="mu sm">${esc(t.label)}</div><div class="row" style="justify-content:space-between;align-items:flex-end"><div><span class="big" style="font-size:26px">${esc(t.now)}</span> <span class="mu sm">from ${esc(t.before)}</span></div>${miniSpark(t.series, col)}</div><div class="sm ${cls}">${label}</div></div>`;
}).join('')}</div></section>` : '';

const recRow = (r, kind) => `<li><div class="row" style="justify-content:space-between"><b>${heroLink(_heroes[r.id], r.id)}</b><span class="pill ${r.conf}">${r.conf} confidence</span></div><ul class="ev">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></li>`;
const recsCard = (recs, form) => `<section class="card"><h2>Who to play</h2>
${recs.play.length ? `<h3>Play more</h3><ul class="recs">${recs.play.map(r => recRow(r)).join('')}</ul>` : '<p class="mu">Play 8+ games on a few heroes and Astra can rank them.</p>'}
${recs.stop.length ? `<h3 style="margin-top:14px">Stop or limit</h3><ul class="recs">${recs.stop.map(r => recRow(r)).join('')}</ul>` : ''}
${form.length ? `<h3 style="margin-top:14px">Form changes (last 10 games on the hero)</h3><ul class="ev">${form.map(f => `<li>${esc(f.name)}: ${pc(f.recentWR)} lately (${f.recentN} games) against ${pc(f.olderWR)} before. ${f.delta > 0 ? 'Heating up.' : 'Cooling off.'}</li>`).join('')}</ul>` : ''}
<p class="mu sm" style="margin:12px 0 0">Ranked by long-run win rate blended with the hero's bracket average, recent form and your preferences. Details on the Heroes page.</p></section>`;

const toneIcon = { good: '▲', bad: '▼', info: '•' };
const notesList = notes => `<ul class="notes">${notes.map(n => `<li class="${n.tone}"><span aria-hidden="true">${toneIcon[n.tone]}</span> ${esc(n.text)}</li>`).join('')}</ul>`;
const lastGameCard = (m, notes) => m ? `<section class="card"><h2>Your last game</h2><div class="row" style="justify-content:space-between;margin-bottom:8px"><a class="rowlink hero" href="#/match/${m.id}">${portrait(_heroes[m.h])}<span>${esc(_heroes[m.h] ? _heroes[m.h].name : 'Hero ' + m.h)} · <span class="${won(m) ? 'w' : 'l'}">${won(m) ? 'Win' : 'Loss'}</span> · ${mmss(m.d)} · ${m.k}/${m.de}/${m.a}</span></a></div>${notes.length ? notesList(notes) : '<p class="mu">A fairly typical game for you.</p>'}</section>` : '';

/** Goal, role and focus at the top of the Coach page, so Preferences visibly drive the coaching. */
function setupBanner({ prefs, focusFound, focusName, facts }) {
  const bits = [];
  if (prefs.goal) bits.push(`<span><b>Goal</b> ${esc(prefs.goal)}</span>`);
  if (prefs.role) bits.push(`<span><b>Role</b> ${esc(prefs.role)}</span>`);
  if (prefs.focus) bits.push(`<span><b>Focus</b> ${esc(focusName)}${focusFound === false ? ' <em class="mu">(no clear weakness here in your data)</em>' : ''}</span>`);
  if (prefs.favorites.length) bits.push(`<span><b>Favourites</b> ${prefs.favorites.length}</span>`);
  if (facts) bits.push(`<span><b>Astra remembers</b> ${facts} thing${facts === 1 ? '' : 's'} about you</span>`);
  return bits.length
    ? `<div class="setup">${bits.join('')}<a href="#/prefs">Edit</a></div>`
    : `<div class="setup empty-setup"><span>Set your role, goal and focus in <a href="#/prefs">Preferences</a>, or just tell Astra: "my role is carry, my goal is Divine".</span></div>`;
}

export function coachHome({ account, matches, insights, window: win, benchPending, trends = [], recs = { play: [], stop: [] }, form = [], lastNotes = [], setup = null }) {
  account = account || { name: 'Player', rankTier: null, avatar: '' };
  const total = matches.length, w = matches.filter(won).length;
  const last10 = matches.slice(0, 10), l10 = last10.filter(won).length;
  const roll = rollingWR(matches.slice(0, 220), 20);
  const faults = insights.filter(i => i.kind === 'fault'), strengths = insights.filter(i => i.kind === 'strength');
  const top = faults.slice(0, 4);
  return `<section class="card"><div class="me">${account.avatar ? `<img class="avatar" src="${esc(account.avatar)}" alt="" width="64" height="64" data-ini="${esc(account.name.slice(0, 1))}">` : ''}<div><h1 style="margin:0">${esc(account.name)}</h1><div class="mu">Ranked only · ${total} games synced</div></div></div>
<div class="stats"><div><div class="big first">${esc(rankName(account.rankTier))}</div><span class="mu sm">rank</span></div>
<div><div class="big">${pc1(w / total)}</div><span class="mu sm">ranked win rate</span></div>
<div><div class="big ${l10 >= 5 ? 'w' : 'l'}">${l10}–${last10.length - l10}</div><span class="mu sm">last ${last10.length}</span></div></div>
${roll.length > 1 ? `<div class="spark-wrap"><div class="mu sm">Rolling 20-game win rate (dashed line is 50%)</div>${spark(roll)}</div>` : ''}${setup ? setupBanner(setup) : ''}</section>
<div class="grid two"><section class="card"><h2>Your plan</h2>
${top.length ? `<ol class="plan">${top.map((i, k) => planItem(i, k + 1)).join('')}</ol><p class="mu sm" style="margin:14px 0 0">Based on your last ${win} ranked games. Ranked by estimated win-rate impact, weighted by how sure we are. Patterns are correlations, not proof.${benchPending ? ' Farm benchmarks are still loading.' : ''}</p>`
    : `<div class="empty"><h2>No clear weakness found</h2><p>${total < 30 ? `Astra needs 30+ ranked games to find patterns; you have ${total}.` : 'Nothing in your last ' + win + ' games stands out statistically. That is a good sign. Sync again after more games.'}</p></div>`}
</section><section class="card"><h2>What you do well</h2>
${strengths.length ? `<ol class="plan str">${strengths.slice(0, 4).map((i, k) => planItem(i, k + 1)).join('')}</ol>` : '<div class="empty"><p>No standout strengths yet. More games make this clearer.</p></div>'}
</section></div>
<div class="grid two" style="margin-top:18px">${recsCard(recs, form)}<div>${trendsCard(trends)}${lastGameCard(matches[0], lastNotes)}</div></div>`;
}

// ---------- heroes ----------
const heroRow = (r, hero, extra = '') => `<tr><td>${heroLink(hero, r.id)}</td><td class="num">${r.g || ''}</td><td class="num">${r.g ? `<span class="bar" aria-hidden="true"><i style="width:${Math.min(100, r.wr * 100)}%"></i></span>${pc(r.wr)}` : ''}</td><td class="num">${pc(r.meta)}</td>${extra}</tr>`;

export function heroesView({ rows, heroes, lists, bracketLabel, prefs, sort }) {
  const sorted = [...rows].sort((a, b) => (sort === 'wr' ? b.adj - a.adj : sort === 'recent' ? b.last - a.last : b.g - a.g));
  const head = '<tr><th>Hero</th><th class="num">Games</th><th class="num">Your WR</th><th class="num">Meta WR</th></tr>';
  const tbl = (list, withG = true) => `<div class="tw"><table><thead>${withG ? head : '<tr><th>Hero</th><th class="num"></th><th class="num"></th><th class="num">Meta WR</th></tr>'}</thead><tbody>${list.map(r => heroRow(r, heroes[r.id])).join('')}</tbody></table></div>`;
  const note = prefs.role && prefs.role !== 'mid' ? `Filtered to ${esc(prefs.role)} heroes.` : prefs.role === 'mid' ? 'OpenDota has no mid tag, so mid shows all heroes.' : '';
  return `<h1>Heroes</h1><p class="mu" style="margin:0 0 18px">Your results next to public ${esc(bracketLabel)} win rates. Win rates are blended toward the hero's meta so small samples count less. ${note}</p>
<div class="grid three"><section class="card"><h2>Lean on</h2>${lists.lean.length ? tbl(lists.lean) : '<p class="mu">Play 8+ games on a hero to rank it.</p>'}</section>
<section class="card"><h2>Limit</h2>${lists.limit.length ? tbl(lists.limit) : '<p class="mu">No hero with 10+ games is dragging you down.</p>'}</section>
<section class="card"><h2>Worth learning</h2>${tbl(lists.learn.map(l => ({ ...l, g: 0 })), false)}<p class="mu sm" style="margin:10px 0 0">Strong and commonly picked in ${esc(bracketLabel)}, and new to you.</p></section></div>
<section class="card" style="margin-top:18px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">All your heroes</h2><label class="sm mu">Sort <select data-sort aria-label="Sort heroes"><option value="games"${sort === 'games' ? ' selected' : ''}>Most played</option><option value="wr"${sort === 'wr' ? ' selected' : ''}>Best adjusted win rate</option><option value="recent"${sort === 'recent' ? ' selected' : ''}>Recently played</option></select></label></div>
<div class="tw"><table class="wide"><thead><tr><th>Hero</th><th class="num">Games</th><th class="num">Your WR</th><th class="num">Meta WR</th><th class="num">KDA</th><th class="num">GPM</th><th class="num">Deaths/min</th></tr></thead><tbody>${sorted.map(r => heroRow(r, heroes[r.id], `<td class="num">${r.k.toFixed(1)}/${r.de.toFixed(1)}/${r.a.toFixed(1)}</td><td class="num">${Math.round(r.gpm)}</td><td class="num">${r.dpm.toFixed(2)}</td>`)).join('')}</tbody></table></div></section>`;
}

export function heroPage({ hero, id, row, matches, bench, pctGpm, matchups, bracketLabel, prefs }) {
  if (!hero) return notice('err', 'Unknown hero.');
  const fav = prefs.favorites.includes(id), av = prefs.avoided.includes(id);
  const mu = matchups ? matchups.filter(m => m.games_played >= 200).map(m => ({ ...m, wr: m.wins / m.games_played })) : [];
  const bad = [...mu].sort((a, b) => a.wr - b.wr).slice(0, 5), good = [...mu].sort((a, b) => b.wr - a.wr).slice(0, 5);
  return `<p><a href="#/heroes">← Heroes</a></p><div class="hero-head">${portrait(hero, { big: true })}<div><h1 style="margin:0">${esc(hero.name)}</h1><div class="mu">${esc(hero.primary)} · ${esc(hero.attack)} · ${esc((hero.roles || []).join(', '))}</div>
<div class="row" style="margin-top:10px"><button data-act="fav" data-id="${id}" aria-pressed="${fav}">${fav ? '★ Favourite' : '☆ Favourite'}</button><button data-act="avoid" data-id="${id}" aria-pressed="${av}">${av ? 'Avoided' : 'Avoid'}</button></div></div></div>
<div class="grid two"><section class="card"><h2>Your results</h2>${row ? `<div class="stats"><div><div class="big">${row.g}</div><span class="mu sm">games</span></div><div><div class="big ${row.wr >= 0.5 ? 'w' : 'l'}">${pc1(row.wr)}</div><span class="mu sm">win rate</span></div><div><div class="big">${pc1(row.meta)}</div><span class="mu sm">${esc(bracketLabel)} meta</span></div></div>
<div class="tw" style="margin-top:14px"><table><tbody><tr><td>Adjusted win rate</td><td class="num">${pc1(row.adj)}</td></tr><tr><td>Avg KDA</td><td class="num">${row.k.toFixed(1)} / ${row.de.toFixed(1)} / ${row.a.toFixed(1)}</td></tr><tr><td>GPM / XPM</td><td class="num">${Math.round(row.gpm)} / ${Math.round(row.xpm)}</td></tr><tr><td>Deaths per minute</td><td class="num">${row.dpm.toFixed(2)}</td></tr>${pctGpm != null ? `<tr><td>GPM percentile (all-rank benchmark)</td><td class="num">${ordinal(Math.round(pctGpm * 100))}</td></tr>` : ''}</tbody></table></div>${row.g < 10 ? '<p class="mu sm">Fewer than 10 games: treat these as a rough read.</p>' : ''}` : '<div class="empty"><p>You have no ranked games on this hero yet.</p></div>'}</section>
<section class="card"><h2>Matchups</h2>${mu.length ? `<h3>Beats</h3>${matchTable(good)}<h3 style="margin-top:14px">Struggles against</h3>${matchTable(bad)}<p class="mu sm" style="margin:12px 0 0">Public win rates across all ranks (200+ games per pairing).</p>` : '<p class="mu">Matchup data unavailable right now.</p>'}</section></div>
${matches.length ? `<section class="card" style="margin-top:18px"><h2>Recent games on ${esc(hero.name)}</h2>${matches.slice(0, 10).map(matchRow).join('')}</section>` : ''}`;
}
let _heroes = {};
export const setHeroes = h => { _heroes = h; };
const matchTable = list => `<div class="tw"><table><tbody>${list.map(m => `<tr><td>${heroLink(_heroes[m.hero_id], m.hero_id)}</td><td class="num">${pc(m.wr)}</td><td class="num mu">${m.games_played}</td></tr>`).join('')}</tbody></table></div>`;

// ---------- matches ----------
export function matchRow(m) {
  const hero = _heroes[m.h], wn = won(m);
  return `<a class="mrow" href="#/match/${m.id}"><span class="res ${wn ? 'w' : 'l'}" aria-label="${wn ? 'Win' : 'Loss'}">${wn ? 'W' : 'L'}</span><span class="hero">${portrait(hero)}<span>${esc(hero ? hero.name : 'Hero ' + m.h)}</span></span><span class="kda">${m.k}/${m.de}/${m.a}</span>
<span></span><span class="sub">${when(m.t)} · ${mmss(m.d)}${m.gpm != null ? ' · ' + m.gpm + ' GPM' : ''}${m.p > 1 ? ' · party of ' + m.p : ''}${m.parsed ? ' <span class="pill parsed">parsed</span>' : ''}</span><span></span></a>`;
}

export function matchesView(matches, shown) {
  return `<h1>Matches</h1><p class="mu" style="margin:0 0 18px">Your ranked games, newest first. Parsed games have extra detail.</p><section class="card">${matches.slice(0, shown).map(matchRow).join('') || '<div class="empty"><p>No matches yet.</p></div>'}${shown < matches.length ? `<div class="row" style="margin-top:14px;justify-content:center"><button data-act="more">Show more (${matches.length - shown} left)</button></div>` : ''}</section>`;
}

const TRIVIAL = new Set(['tango', 'flask', 'clarity', 'faerie_fire', 'enchanted_mango', 'branches', 'ward_observer', 'ward_sentry', 'tpscroll', 'smoke_of_deceit', 'dust', 'blood_grenade', 'cheese', 'ward_dispenser', 'infused_raindrop', 'bottle', 'magic_stick', 'gauntlets', 'slippers', 'mantle', 'circlet', 'belt_of_strength', 'robe', 'ogre_axe', 'blade_of_alacrity', 'staff_of_wizardry', 'quelling_blade', 'orb_of_venom', 'orb_of_corrosion', 'ring_of_protection', 'sobi_mask', 'blades_of_attack', 'chainmail', 'helm_of_iron_will', 'broadsword', 'blitz_knuckles', 'boots', 'gloves', 'ring_of_regen', 'cloak', 'fluffy_hat', 'crown', 'wind_lace', 'recipe_x']);
const nice = k => k.replace(/_/g, ' ');
const MR = { 1: 'Safe lane', 2: 'Mid', 3: 'Off lane', 4: 'Jungle' };

export function matchDetail({ d, meId, heroList, parseState, notes = [] }) {
  if (!d) return notice('err', 'Match not found.');
  const me = d.players.find(p => p.account_id === meId) || null;
  const meWon = me ? (me.player_slot < 128) === d.radiant_win : null;
  const rows = d.players.map(p => {
    const h = _heroes[p.hero_id];
    return `<tr class="${p === me ? 'mine' : ''}"><td>${p.player_slot < 128 ? 'Radiant' : 'Dire'}</td><td>${heroLink(h, p.hero_id)}</td><td class="num">${p.kills}/${p.deaths}/${p.assists}</td><td class="num">${p.gold_per_min}</td><td class="num">${p.xp_per_min}</td><td class="num">${p.last_hits}</td><td class="num">${p.hero_damage ?? ''}</td></tr>`;
  }).join('');
  let extra = notes.length ? `<section class="card"><h2>What stood out</h2>${notesList(notes)}<p class="mu sm" style="margin:10px 0 0">Compared with your own recent games and your record on this hero.</p></section>` : '';
  if (me && me.benchmarks) {
    const b = me.benchmarks;
    const names = { gold_per_min: 'GPM', xp_per_min: 'XPM', last_hits_per_min: 'Last hits/min', hero_damage_per_min: 'Hero damage/min', hero_healing_per_min: 'Healing/min', tower_damage: 'Tower damage' };
    const r = Object.keys(names).filter(k => b[k] && b[k].raw != null && +b[k].raw > 0).map(k => `<tr><td>${names[k]}</td><td class="num">${(+b[k].raw).toFixed(k.includes('last_hits') ? 2 : 0)}</td><td class="num">${ordinal(Math.round(b[k].pct * 100))}</td></tr>`).join('');
    extra += `<section class="card"><h2>Versus this hero's benchmarks</h2><div class="tw"><table><thead><tr><th>Stat</th><th class="num">You</th><th class="num">Percentile</th></tr></thead><tbody>${r}</tbody></table></div><p class="mu sm" style="margin:10px 0 0">OpenDota benchmarks for this hero across all ranks.</p></section>`;
  }
  const parsed = me && me.purchase_log;
  if (parsed) {
    const side = me.player_slot < 128 ? 1 : -1;
    const items = [], seen = new Set();
    for (const p of me.purchase_log) { if (p.time > 0 && !TRIVIAL.has(p.key) && !p.key.startsWith('recipe_') && !seen.has(p.key)) { seen.add(p.key); items.push(p); } }
    // Your deaths = enemy kill logs entries naming your hero.
    const myKey = heroList && heroList[me.hero_id] ? heroList[me.hero_id].key : null;
    const deaths = [];
    if (myKey) for (const p of d.players) if (p.isRadiant !== (me.player_slot < 128) && p.kills_log) for (const k of p.kills_log) if (k.key === myKey) deaths.push(k.time);
    deaths.sort((a, b) => a - b);
    extra += `<section class="card"><h2>Lane and vision</h2><div class="stats">${me.lane_role ? `<div><div class="big">${MR[me.lane_role] || '–'}</div><span class="mu sm">lane${me.is_roaming ? ' (roaming)' : ''}</span></div>` : ''}${me.lane_efficiency_pct != null ? `<div><div class="big">${me.lane_efficiency_pct}%</div><span class="mu sm">lane efficiency</span></div>` : ''}<div><div class="big">${me.obs_placed ?? 0} / ${me.sen_placed ?? 0}</div><span class="mu sm">observer / sentry wards</span></div></div></section>
<section class="card"><h2>Item timings</h2><div class="tw"><table><tbody>${items.slice(0, 12).map(p => `<tr><td>${esc(nice(p.key))}</td><td class="num">${mmss(p.time)}</td></tr>`).join('')}</tbody></table></div></section>`;
    if (d.radiant_gold_adv) extra += `<section class="card"><h2>Gold advantage</h2><div class="mu sm">${side === 1 ? 'Above the line means your team (Radiant) was ahead' : 'Above the line means your team (Dire) was ahead'}</div>${advChart(d.radiant_gold_adv.map(v => v * side), { label: 'Team gold advantage over time' })}</section>`;
    if (d.radiant_xp_adv) extra += `<section class="card"><h2>XP advantage</h2>${advChart(d.radiant_xp_adv.map(v => v * side), { label: 'Team XP advantage over time' })}</section>`;
    if (deaths.length) extra += `<section class="card"><h2>Death timeline</h2>${deathTimeline(deaths, d.duration)}<p class="mu sm" style="margin:10px 0 0">Died at ${deaths.map(mmss).join(', ')}.</p></section>`;
  } else {
    extra += `<section class="card"><h2>Detailed analysis</h2><p class="mu">This match has not been parsed, so item timings, lane results, wards and gold curves are unavailable.</p>${parseState === 'queued' ? notice('ok', 'Parse requested. It usually takes a few minutes. Reload this page afterwards.') : parseState === 'error' ? notice('err', 'Could not request a parse right now. Try again later.') : `<button class="pri" data-act="parse" data-id="${d.match_id}">Request parse</button>`}</section>`;
  }
  return `<p><a href="#/matches">← Matches</a></p><section class="card"><h1 style="margin:0" class="${meWon == null ? '' : meWon ? 'w' : 'l'}">${meWon == null ? 'Match' : meWon ? 'Victory' : 'Defeat'}</h1><div class="mu">${mmss(d.duration)} · ${new Date(d.start_time * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${d.radiant_score}–${d.dire_score} · ${parsed ? '<span class="pill parsed">parsed</span>' : 'not parsed'}</div></section>
${extra}<section class="card"><h2>Players</h2><div class="tw"><table><thead><tr><th>Team</th><th>Hero</th><th class="num">K/D/A</th><th class="num">GPM</th><th class="num">XPM</th><th class="num">LH</th><th class="num">Hero dmg</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ---------- draft ----------
const slotChips = (ids, kind, heroes, max) => `<div class="chips">${ids.map(id => `<span class="chip">${portrait(heroes[id])}${esc(heroes[id] ? heroes[id].name : id)}<button type="button" aria-label="Remove ${esc(heroes[id] ? heroes[id].name : id)}" data-act="unpick" data-kind="${kind}" data-id="${id}">×</button></span>`).join('')}${ids.length < max ? `<span class="mu sm">${max - ids.length} open</span>` : ''}</div>`;

/** One line saying which preferences shape the list, with a link to change them. */
function prefsLine(prefs) {
  const bits = [];
  if (prefs.role) bits.push(prefs.role === 'mid' ? 'Role: mid (OpenDota has no mid tag, so all heroes are shown)' : `Role filter: ${esc(prefs.role)}`);
  if (prefs.favorites.length) bits.push(`${prefs.favorites.length} favourite${prefs.favorites.length === 1 ? '' : 's'} boosted`);
  if (prefs.avoided.length) bits.push(`${prefs.avoided.length} avoided hero${prefs.avoided.length === 1 ? '' : 'es'} excluded`);
  return `<p class="prefs-line sm">${bits.length ? bits.join(' · ') : 'No role filter or favourites set'} · <a href="#/prefs">Preferences</a></p>`;
}

export function draftView({ draft, heroes, results, hints, loading, prefs }) {
  const picked = new Set([...draft.allies, ...draft.enemies]);
  const avoided = new Set(prefs.avoided), fav = new Set(prefs.favorites);
  const all = Object.values(heroes).sort((a, b) => a.name.localeCompare(b.name));
  const grid = all.map(h => `<button type="button" class="hbtn${avoided.has(h.id) ? ' av' : ''}${fav.has(h.id) ? ' fv' : ''}" data-act="pick" data-id="${h.id}" data-name="${esc(h.name.toLowerCase())}" ${picked.has(h.id) ? 'disabled' : ''} title="${esc(h.name)}${avoided.has(h.id) ? ' (avoided)' : fav.has(h.id) ? ' (favourite)' : ''}">${portrait(h)}<span>${esc(h.name)}</span></button>`).join('');
  const rows = results.slice(0, 8).map((r, i) => `<tr><td class="num">${i + 1}</td><td>${heroLink(heroes[r.id], r.id)}</td><td class="num"><b>${r.score >= 0 ? '+' : ''}${(r.score * 100).toFixed(1)}</b></td><td><span class="pill ${r.conf}">${r.conf}</span></td><td><details><summary>Why</summary><ul class="ev">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details></td></tr>`).join('');
  const mine = draft.mine && heroes[draft.mine] ? `<div class="chips"><span class="chip">${portrait(heroes[draft.mine])}${esc(heroes[draft.mine].name)}<button type="button" aria-label="Clear your hero" data-act="unmine">×</button></span></div>` : '<p class="mu sm" style="margin:4px 0 8px">Not set. Say "I\'m playing Zeus".</p>';
  return `<h1>Draft helper</h1><p class="mu" style="margin:0 0 6px">Just say the picks: <b>"enemy has Axe and Lina"</b>, <b>"we have Crystal Maiden"</b>, <b>"remove Axe"</b>. Hold <kbd>V</kbd> or use Ask Astra. Tapping heroes below works too.</p>${prefsLine(prefs)}
<div class="grid two"><section class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Picks</h2><div class="seg" role="radiogroup" aria-label="Which team a tap adds to"><button type="button" role="radio" aria-checked="${draft.mode === 'allies'}" data-act="mode" data-mode="allies">Tap adds to your team</button><button type="button" role="radio" aria-checked="${draft.mode === 'enemies'}" data-act="mode" data-mode="enemies">Tap adds to enemies</button></div></div>
<h3 style="margin-top:14px">Your hero</h3>${mine}
<h3>Your team (besides you)</h3>${slotChips(draft.allies, 'allies', heroes, 4)}
<h3>Enemy team</h3>${slotChips(draft.enemies, 'enemies', heroes, 5)}
<div class="row" style="margin:12px 0 8px"><input type="search" id="hsearch" class="grow" placeholder="Search heroes" aria-label="Search heroes" autocomplete="off" value="${esc(draft.q || '')}"><button type="button" class="ghost" data-act="clear-draft">Clear draft</button></div>
<div class="hgrid" id="hgrid" role="group" aria-label="Heroes">${grid}</div></section>
<section class="card"><h2>Best picks for you</h2>${loading ? '<div class="skel"></div><div class="skel"></div><div class="skel"></div>' : rows ? `<div class="tw"><table><thead><tr><th class="num">#</th><th>Hero</th><th class="num">Score</th><th>Confidence</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="mu">No candidates. Check your role filter and avoided heroes in Preferences.</p>'}
${hints.length ? `<h3 style="margin-top:14px">Team notes</h3><ul class="ev">${hints.map(h => `<li>${esc(h)}</li>`).join('')}</ul><p class="mu sm">Based on OpenDota's coarse role tags, so treat these as hints.</p>` : ''}
<div class="row" style="margin-top:14px"><button class="pri" data-act="explain-draft" ${results.length ? '' : 'disabled'}>Explain this draft</button><span class="mu sm">or ask "what should I pick?"</span></div>
<p class="mu sm" style="margin:12px 0 0">Score is in win-rate points: half your adjusted win rate on the hero, plus 1.5 times the average matchup edge against the enemies, plus half the bracket meta edge. Matchup data shows enemies, not synergy with allies, because OpenDota has no public ally data. Heroes new to you have no personal record and rank lower in confidence.</p></section></div>`;
}

// ---------- live: a conversation with the game beside it ----------

/** Static layout. The conversation and the side panel are filled in separately so typing never loses focus. */
export function liveShell() {
  return `<div class="live">
<section class="card live-convo" aria-label="Conversation with Astra">
  <header class="live-head"><div><h1>Live</h1><p class="mu sm">Talk to Astra during the game. It can't see your screen (that would risk a ban): it knows what you tell it, your history and public hero data.</p></div><span class="status-pill" id="live-status">Ready</span></header>
  <div id="live-log" class="convo" aria-live="polite"></div>
  <p id="live-notice" class="mu sm notice-line" aria-live="polite"></p>
  <form id="live-pass" class="row" data-form="live-pass" hidden><input type="password" name="pass" class="grow" placeholder="Passcode" autocomplete="current-password" aria-label="Astra passcode"><button class="pri">Unlock AI</button></form>
  <div class="live-controls">
    <button id="live-orb" class="orb" type="button" aria-label="Hold to talk"><i></i><span>Hold to talk</span></button>
    <div class="grow">
      <form class="row" data-form="live-say"><input name="text" id="live-in" class="grow" maxlength="500" placeholder="Say or type: &quot;they picked Axe&quot;, &quot;I just died to a gank&quot;, &quot;what now?&quot;" aria-label="Message Astra" autocomplete="off"><button class="pri">Send</button></form>
      <div class="row sm mu toggles">
        <label class="switch"><input type="checkbox" id="live-conv"><span></span> Conversation mode <em>(hands-free)</em></label>
        <label class="switch"><input type="checkbox" id="live-tts"><span></span> Speak replies</label>
        <span class="grow"></span><button type="button" class="ghost" data-act="convo-clear">Clear chat</button>
      </div>
    </div>
  </div>
</section>
<aside id="live-side" class="live-side"></aside>
</div>`;
}

export function liveSide({ running, elapsed, draft, heroes, drills, notes, reminders, picks, focusName }) {
  const names = ids => ids.length ? ids.map(id => esc(heroes[id] ? heroes[id].name : id)).join(', ') : '<span class="mu">none yet</span>';
  return `<section class="card"><div class="row" style="justify-content:space-between;align-items:center"><div class="clock" id="clock" role="timer" aria-label="Game clock">${running ? mmss(elapsed) : '0:00'}</div>
${running ? '<button data-act="live-finish" class="pri">Game finished</button>' : '<button data-act="live-start" class="pri">Start game</button>'}</div>
<div class="chips" style="margin-top:10px">${['Died', 'Won a fight', 'Lost a fight', 'Took Roshan', 'Lost a tower', 'Farm is behind'].map(t => `<button type="button" class="chip-btn" data-act="live-note" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
${notes.length ? `<ol class="timeline">${notes.slice(-8).map(n => `<li><time>${n.t != null ? mmss(n.t) : '–'}</time> ${esc(n.text)}</li>`).join('')}</ol>` : '<p class="mu sm" style="margin:10px 0 0">Notes you say during the game appear here with the game time.</p>'}</section>
<section class="card"><h2>Draft</h2>
<p class="sm" style="margin:0 0 6px">${draft.mine && heroes[draft.mine] ? `<b>You:</b> ${esc(heroes[draft.mine].name)}<br>` : ''}<b>Your team:</b> ${names(draft.allies)}<br><b>Enemies:</b> ${names(draft.enemies)}</p>
${picks.length ? `<p class="sm" style="margin:8px 0 4px"><b>Best picks now</b></p><ol class="picks">${picks.slice(0, 3).map(r => `<li>${heroLink(heroes[r.id], r.id)} <b>${r.score >= 0 ? '+' : ''}${(r.score * 100).toFixed(1)}</b> <span class="pill ${r.conf}">${r.conf}</span></li>`).join('')}</ol>` : ''}
<p class="sm" style="margin:6px 0 0"><a href="#/draft">Open the draft</a></p></section>
<section class="card"><h2>Your focus</h2>${focusName ? `<p class="sm" style="margin:-4px 0 8px"><span class="pill focus">${esc(focusName)}</span></p>` : ''}${drills.length ? `<ol class="ev">${drills.map(d => `<li><b>${esc(d.title)}.</b> ${esc(d.drill)}</li>`).join('')}</ol>` : '<p class="mu">Sync more games to get a plan.</p>'}
<label class="switch sm" style="margin-top:10px"><input type="checkbox" data-act="reminders" ${reminders ? 'checked' : ''}><span></span> Spoken reminders (5, 12, 20 min, then a deaths check every 10 min)</label></section>`;
}

// ---------- preferences ----------
export function prefsView({ prefs, heroes, facts, focusAreas, saved }) {
  const names = Object.values(heroes).sort((a, b) => a.name.localeCompare(b.name));
  const chips = (ids, kind) => ids.length ? `<div class="chips">${ids.map(id => `<span class="chip">${portrait(heroes[id])}${esc(heroes[id] ? heroes[id].name : id)}<button type="button" aria-label="Remove ${esc(heroes[id] ? heroes[id].name : id)}" data-act="rm-${kind}" data-id="${id}">×</button></span>`).join('')}</div>` : '<p class="mu sm" style="margin:6px 0">None yet.</p>';
  const dl = `<datalist id="hl">${names.map(h => `<option value="${esc(h.name)}"></option>`).join('')}</datalist>`;
  return `<h1>Preferences</h1><p class="mu" style="margin:0 0 18px">Everything here changes your coaching straight away. You can also just say it to Astra: "my role is carry", "add Zeus to my favourites", "focus on deaths".</p>
${saved ? notice('ok', 'Saved. Your Coach, Heroes, Draft and Live pages now use these settings.') : ''}
<form class="card" data-form="prefs">${dl}<h2>Coaching setup</h2>
<div class="pref-grid">
<div><label class="f" for="role">Role</label><select id="role" name="role"><option value="">Any role</option><option value="carry"${prefs.role === 'carry' ? ' selected' : ''}>Carry</option><option value="mid"${prefs.role === 'mid' ? ' selected' : ''}>Mid</option><option value="support"${prefs.role === 'support' ? ' selected' : ''}>Support</option></select>
<p class="mu sm">Filters "Who to play", Heroes lists and Draft picks to heroes tagged Carry or Support. OpenDota has no mid tag, so mid shows all heroes.</p></div>
<div><label class="f" for="focus">Focus area</label><select id="focus" name="focus"><option value="">No focus (rank by impact)</option>${focusAreas.map(([id, label]) => `<option value="${id}"${prefs.focus === id ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
<p class="mu sm">Pinned to the top of your plan on the Coach page and used first for spoken reminders in Live.</p></div>
<div class="span2"><label class="f" for="goal">Goal</label><input id="goal" name="goal" style="width:100%" maxlength="120" placeholder="e.g. Reach Divine this season" value="${esc(prefs.goal)}">
<p class="mu sm">Shown on your Coach page and given to the AI, so its advice works toward it.</p></div>
</div>
<div class="row" style="margin-top:6px"><button class="pri">Save</button></div></form>
<div class="grid two"><section class="card"><h2>Favourite heroes <span class="mark fav">★</span></h2><p class="mu sm" style="margin-top:-6px">Boosted in recommendations and the draft, and starred everywhere.</p>${chips(prefs.favorites, 'fav')}<div class="row"><input list="hl" data-add="fav" class="grow" placeholder="Add a hero" aria-label="Add favourite hero"><button type="button" data-act="add-fav">Add</button></div></section>
<section class="card"><h2>Avoided heroes <span class="mark avoid">⊘</span></h2><p class="mu sm" style="margin-top:-6px">Never recommended in "Who to play", Heroes lists or the draft.</p>${chips(prefs.avoided, 'avoid')}<div class="row"><input list="hl" data-add="avoid" class="grow" placeholder="Add a hero" aria-label="Add avoided hero"><button type="button" data-act="add-avoid">Add</button></div></section></div>
<section class="card"><h2>What Astra remembers about you</h2><p class="mu sm" style="margin-top:-6px">Things you told Astra (for example "I struggle against Broodmother"). The AI uses them to personalise advice. Say "remember that …" or "forget …", or edit here.</p>
${facts.length ? `<ul class="facts">${facts.map(f => `<li><span>${esc(f.text)}</span><time class="mu sm">${new Date(f.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time><button type="button" class="ghost" aria-label="Forget: ${esc(f.text)}" data-act="rm-fact" data-fid="${esc(f.id)}">Forget</button></li>`).join('')}</ul>` : '<p class="mu sm">Nothing yet.</p>'}
<form class="row" data-form="add-fact" style="margin-top:8px"><input name="text" class="grow" maxlength="200" placeholder="Add something Astra should know" aria-label="Add a fact for Astra"><button class="pri">Add</button></form></section>
<section class="card"><h2>Data</h2><div class="row"><button data-act="resync">Re-sync everything</button><button data-act="convo-clear">Clear conversation</button><button data-act="logout" class="ghost">Switch player</button></div></section>`;
}
