// Query engine for the AI: any slice of the player's full ranked history, computed here in the browser.
// The AI asks for exactly the numbers a question needs (a hero, a matchup, a period, a breakdown), the app runs
// the query over every synced game, and the AI answers from the result. Pure functions, no DOM, no network.
import { won, dpm, avg, sessionize } from './analysis.js';
import { gameRole, periodRange } from './coach.js';
import { resolveHero, heroesInText } from './context.js';

const DAY = 86400;
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const pct = x => Math.round(x * 100) + '%';

export const GROUP_BY = ['none', 'hero', 'enemy', 'ally', 'role', 'month', 'week', 'weekday', 'timeOfDay', 'duration', 'party', 'result', 'sessionGame', 'afterResult'];
export const SORT_BY = ['games', 'winRate', 'kda', 'gpm', 'deaths', 'recent'];
export const PERIOD_NAMES = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year'];
export const MAX_QUERIES = 4;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME_BUCKETS = [['night', 'Night (00-06)'], ['morning', 'Morning (06-12)'], ['afternoon', 'Afternoon (12-18)'], ['evening', 'Evening (18-24)']];
const timeBucket = t => TIME_BUCKETS[Math.floor(new Date(t * 1000).getHours() / 6)];
const DURATIONS = [[0, 25, 'Under 25 min'], [25, 35, '25-35 min'], [35, 45, '35-45 min'], [45, Infinity, '45+ min']];
const durationLabel = m => DURATIONS.find(([a, b]) => m.d / 60 >= a && m.d / 60 < b)[2];
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const weekOf = t => { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return 'Week of ' + ymd(d); };

/** Does this game have team compositions (synced after team data was added)? */
export const hasTeams = m => Array.isArray(m.en) && Array.isArray(m.al);

/** Totals and averages for a set of games, in the compact shape sent to the AI. */
export function statsOf(list) {
  if (!list.length) return { games: 0 };
  const w = list.filter(won).length, rated = list.filter(m => m.d > 600);
  const num = f => { const xs = list.filter(m => f(m) != null && Number.isFinite(f(m))); return xs.length ? avg(xs, f) : null; };
  const out = {
    games: list.length, record: w + '-' + (list.length - w), winRate: pct(w / list.length),
    kda: r1(avg(list, m => m.k)) + '/' + r1(avg(list, m => m.de)) + '/' + r1(avg(list, m => m.a)),
    kdaRatio: r1(avg(list, m => (m.k + m.a) / Math.max(1, m.de))),
    deathsPerMin: rated.length ? r2(avg(rated, dpm)) : null,
    gpm: num(m => m.gpm), xpm: num(m => m.xpm),
    lastHitsPerMin: num(m => (m.lh != null && m.d > 600 ? m.lh / (m.d / 60) : null)),
    heroDamage: num(m => m.hd), towerDamage: num(m => m.td), heroHealing: num(m => m.hh),
    avgMinutes: Math.round(avg(list, m => m.d / 60)),
  };
  for (const k of ['gpm', 'xpm', 'heroDamage', 'towerDamage', 'heroHealing']) if (out[k] != null) out[k] = Math.round(out[k]);
  if (out.lastHitsPerMin != null) out.lastHitsPerMin = r1(out.lastHitsPerMin);
  if (!out.heroHealing) delete out.heroHealing;
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  if (list.length < 10) out.sample = 'small (under 10 games): a weak signal';
  return out;
}

const heroIds = (names, heroes) => {
  const ids = [], unknown = [];
  for (const n of (Array.isArray(names) ? names : names ? [names] : []).slice(0, 5)) {
    const id = resolveHero(n, heroes);
    if (id != null) ids.push(id); else unknown.push(String(n).slice(0, 40));
  }
  return { ids, unknown };
};

/** Clean a query from the AI (or the auto-builder): known keys only, bounded values. */
export function normalizeQuery(q) {
  if (!q || typeof q !== 'object') return null;
  const out = {};
  const list = v => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 5).map(x => x.trim().slice(0, 40));
  const n = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : undefined);
  if (typeof q.label === 'string') out.label = q.label.slice(0, 80);
  for (const k of ['hero', 'with', 'against']) { const v = list(q[k]); if (v.length) out[k] = v; }
  if (q.result === 'win' || q.result === 'loss') out.result = q.result;
  if (PERIOD_NAMES.includes(q.period)) out.period = q.period;
  out.lastGames = n(q.lastGames, 1, 5000); out.lastDays = n(q.lastDays, 1, 5000);
  for (const k of ['from', 'to']) if (typeof q[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q[k])) out[k] = q[k];
  out.minMinutes = n(q.minMinutes, 0, 200); out.maxMinutes = n(q.maxMinutes, 1, 200);
  if (q.party === 'solo' || q.party === 'party') out.party = q.party;
  if (['carry', 'core', 'support'].includes(q.role)) out.role = q.role;
  if (TIME_BUCKETS.some(([k]) => k === q.timeOfDay)) out.timeOfDay = q.timeOfDay;
  const days = list(q.weekday).map(d => d.toLowerCase().slice(0, 3)).filter(d => WEEKDAYS.includes(d));
  if (days.length) out.weekday = days;
  if (GROUP_BY.includes(q.groupBy) && q.groupBy !== 'none') out.groupBy = q.groupBy;
  if (SORT_BY.includes(q.sortBy)) out.sortBy = q.sortBy;
  if (q.order === 'asc' || q.order === 'desc') out.order = q.order;
  out.minGames = n(q.minGames, 1, 500); out.limit = n(q.limit, 1, 25);
  if (q.listGames === true) out.listGames = true;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** Human-readable description of a query's filters, so the AI can quote what was measured. */
function describe(q, heroes) {
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  const parts = [];
  if (q.heroIds && q.heroIds.length) parts.push('playing ' + q.heroIds.map(name).join(' or '));
  if (q.withIds && q.withIds.length) parts.push('with ' + q.withIds.map(name).join(' and ') + ' on your team');
  if (q.againstIds && q.againstIds.length) parts.push('against ' + q.againstIds.map(name).join(' and '));
  if (q.result) parts.push(q.result === 'win' ? 'wins only' : 'losses only');
  if (q.period) parts.push(q.period.replace('_', ' '));
  if (q.lastDays) parts.push('last ' + q.lastDays + ' days');
  if (q.from || q.to) parts.push((q.from ? 'from ' + q.from : '') + (q.to ? ' to ' + q.to : ''));
  if (q.minMinutes != null || q.maxMinutes != null) parts.push('games ' + (q.minMinutes != null ? q.minMinutes : 0) + '-' + (q.maxMinutes != null ? q.maxMinutes : '∞') + ' min');
  if (q.party) parts.push(q.party === 'solo' ? 'solo queue' : 'in a party');
  if (q.role) parts.push('as ' + q.role + ' (estimated from last hits)');
  if (q.timeOfDay) parts.push('played in the ' + q.timeOfDay);
  if (q.weekday) parts.push('on ' + q.weekday.join('/'));
  if (q.lastGames) parts.push('most recent ' + q.lastGames + ' matching games');
  return parts.join(', ') || 'all synced ranked games';
}

/** Time-only filters (used both for the query and for its baseline). */
function timeFilter(list, q, now) {
  let out = list;
  const nowSec = now.getTime() / 1000;
  if (q.period) {
    const kind = { today: 'day', yesterday: 'day', this_week: 'week', last_week: 'week', this_month: 'month', last_month: 'month', this_year: 'year', last_year: 'year' }[q.period];
    const r = periodRange(kind, now);
    const [a, b] = /^(yesterday|last_)/.test(q.period) ? [r.prevStart, r.prevEnd] : [r.start, r.end];
    out = out.filter(m => m.t >= a && m.t < b);
  }
  if (q.lastDays) out = out.filter(m => nowSec - m.t <= q.lastDays * DAY);
  if (q.from) { const a = new Date(q.from + 'T00:00:00').getTime() / 1000; out = out.filter(m => m.t >= a); }
  if (q.to) { const b = new Date(q.to + 'T00:00:00').getTime() / 1000 + DAY; out = out.filter(m => m.t < b); }
  return out;
}

/**
 * Run one query over all matches (newest first). Returns a compact result for the AI:
 * { query, games stats, baseline (same period, no other filters), groups?, gamesList?, notes? }.
 */
export function runQuery(matches, heroes, raw, now = new Date()) {
  const q = normalizeQuery(raw);
  if (!q) return { error: 'Empty query.' };
  const notes = [];
  const h = heroIds(q.hero, heroes), w = heroIds(q.with, heroes), a = heroIds(q.against, heroes);
  const unknown = [...h.unknown, ...w.unknown, ...a.unknown];
  if (unknown.length) notes.push('Unknown hero names ignored: ' + unknown.join(', ') + '.');
  q.heroIds = h.ids; q.withIds = w.ids; q.againstIds = a.ids;

  const timed = timeFilter(matches, q, now);
  let list = timed;
  const needsTeams = q.withIds.length || q.againstIds.length || q.groupBy === 'enemy' || q.groupBy === 'ally';
  if (needsTeams) {
    const withTeams = list.filter(hasTeams);
    if (withTeams.length < list.length) notes.push(`${list.length - withTeams.length} of ${list.length} games have no team data (older sync), so ally/enemy figures cover ${withTeams.length} games.`);
    if (!withTeams.length) notes.push('No team compositions are stored yet. They are fetched on the next sync.');
    list = withTeams;
  }
  if (q.heroIds.length) list = list.filter(m => q.heroIds.includes(m.h));
  if (q.withIds.length) list = list.filter(m => q.withIds.every(id => m.al.includes(id)));
  if (q.againstIds.length) list = list.filter(m => q.againstIds.every(id => m.en.includes(id)));
  if (q.result) list = list.filter(m => won(m) === (q.result === 'win'));
  if (q.minMinutes != null) list = list.filter(m => m.d / 60 >= q.minMinutes);
  if (q.maxMinutes != null) list = list.filter(m => m.d / 60 < q.maxMinutes);
  if (q.party) list = list.filter(m => (q.party === 'solo') === ((m.p || 1) <= 1));
  if (q.role) list = list.filter(m => gameRole(m, heroes) === q.role);
  if (q.timeOfDay) list = list.filter(m => timeBucket(m.t)[0] === q.timeOfDay);
  if (q.weekday) list = list.filter(m => q.weekday.includes(WEEKDAYS[new Date(m.t * 1000).getDay()]));
  if (q.lastGames) list = list.slice(0, q.lastGames);

  const out = { query: describe(q, heroes), ...(q.label ? { label: q.label } : {}), result: statsOf(list) };
  // The same period without the other filters, so "is 55% good?" can be answered against the player's norm.
  const filtered = list.length !== timed.length || q.lastGames;
  if (filtered && timed.length) out.baseline = { scope: 'all your games in the same period', games: timed.length, winRate: pct(timed.filter(won).length / timed.length), ...pick(statsOf(timed), ['kda', 'gpm', 'deathsPerMin', 'avgMinutes']) };
  if (q.groupBy) out.groups = groupRows(list, q, heroes, matches);
  if (q.listGames) out.gamesList = list.slice(0, q.limit || 10).map(m => gameRow(m, heroes));
  if (notes.length) out.notes = notes;
  return out;
}

const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null).map(k => [k, o[k]]));

function gameRow(m, heroes) {
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  return {
    date: ymd(new Date(m.t * 1000)), hero: name(m.h), result: won(m) ? 'win' : 'loss', minutes: Math.round(m.d / 60),
    kda: m.k + '/' + m.de + '/' + m.a, ...(m.gpm != null ? { gpm: m.gpm } : {}),
    ...(hasTeams(m) ? { allies: m.al.map(name), enemies: m.en.map(name) } : {}),
  };
}

function groupRows(list, q, heroes, all) {
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  const groups = new Map();
  const add = (key, m) => { if (key == null) return; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(m); };
  let session = null;
  if (q.groupBy === 'sessionGame' || q.groupBy === 'afterResult') {
    session = new Map(sessionize(all).map(s => [s.m.id, s]));
  }
  for (const m of list) {
    switch (q.groupBy) {
      case 'hero': add(name(m.h), m); break;
      case 'enemy': m.en.forEach(id => add(name(id), m)); break;
      case 'ally': m.al.forEach(id => add(name(id), m)); break;
      case 'role': add(gameRole(m, heroes) || 'unknown (short game or no last hits)', m); break;
      case 'month': add(ymd(new Date(m.t * 1000)).slice(0, 7), m); break;
      case 'week': add(weekOf(m.t), m); break;
      case 'weekday': add(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(m.t * 1000).getDay()], m); break;
      case 'timeOfDay': add(timeBucket(m.t)[1], m); break;
      case 'duration': add(durationLabel(m), m); break;
      case 'party': add((m.p || 1) <= 1 ? 'Solo' : 'Party', m); break;
      case 'result': add(won(m) ? 'Wins' : 'Losses', m); break;
      case 'sessionGame': { const s = session.get(m.id); add(s ? (s.pos >= 4 ? 'Game 4+ of a session' : 'Game ' + s.pos + ' of a session') : null, m); break; }
      case 'afterResult': { const s = session.get(m.id); add(!s ? null : s.prevWon == null ? 'First game of a session' : s.prevWon ? 'Straight after a win' : 'Straight after a loss', m); break; }
    }
  }
  const timeLike = ['month', 'week'].includes(q.groupBy);
  const minGames = q.minGames || (['hero', 'enemy', 'ally'].includes(q.groupBy) ? 3 : 1);
  let rows = [...groups.entries()].filter(([, g]) => g.length >= minGames).map(([key, g]) => {
    const s = statsOf(g);
    return { group: key, ...pick(s, ['games', 'record', 'winRate', 'kda', 'gpm', 'deathsPerMin', 'avgMinutes', 'sample']), _wr: g.filter(won).length / g.length, _kda: avg(g, m => (m.k + m.a) / Math.max(1, m.de)), _gpm: s.gpm || 0, _de: avg(g, m => m.de), _t: Math.max(...g.map(m => m.t)) };
  });
  const sortBy = q.sortBy || (timeLike ? 'recent' : 'games');
  const key = { games: r => r.games, winRate: r => r._wr, kda: r => r._kda, gpm: r => r._gpm, deaths: r => r._de, recent: r => r._t }[sortBy];
  const dir = q.order === 'asc' ? 1 : -1;
  rows.sort((x, y) => dir * (key(x) - key(y)) || y.games - x.games);
  const total = rows.length;
  rows = rows.slice(0, q.limit || 12).map(({ _wr, _kda, _gpm, _de, _t, ...r }) => r);
  return total > rows.length ? { sortedBy: sortBy + ' ' + (q.order || 'desc'), shown: rows.length, of: total, rows } : { sortedBy: sortBy + ' ' + (q.order || 'desc'), rows };
}

/** Run several queries, bounded, never throwing. */
export function runQueries(matches, heroes, queries, now = new Date(), max = MAX_QUERIES) {
  return (Array.isArray(queries) ? queries : []).slice(0, max).map(q => {
    try { return runQuery(matches, heroes, q, now); } catch (e) { return { error: 'Query failed: ' + (e.message || e) }; }
  });
}

/**
 * Queries the question obviously needs, computed before the AI is called so most questions are answered in one
 * round: every hero named (as your hero, as an ally, as an enemy) and any period named ("this week", "last 50 games").
 */
export function autoQueries(text, heroes) {
  const l = String(text || '').toLowerCase();
  const out = [];
  const time = {};
  const period = [[/\btoday\b/, 'today'], [/\byesterday\b/, 'yesterday'], [/\bthis week\b/, 'this_week'], [/\blast week\b/, 'last_week'], [/\bthis month\b/, 'this_month'], [/\blast month\b/, 'last_month'], [/\bthis year\b/, 'this_year'], [/\blast year\b/, 'last_year']].find(([re]) => re.test(l));
  if (period) time.period = period[1];
  const lastN = l.match(/\blast (\d{1,4}) (games|matches)\b/);
  if (lastN) time.lastGames = Number(lastN[1]);
  const lastD = l.match(/\b(?:last|past) (\d{1,4}) days\b/);
  if (lastD) time.lastDays = Number(lastD[1]);
  const named = heroesInText(text, heroes).slice(0, 3).map(id => heroes[id].name);
  for (const hero of named) {
    out.push({ label: `You playing ${hero}`, hero: [hero], ...time });
    out.push({ label: `Games against ${hero}`, against: [hero], ...time });
    out.push({ label: `Games with ${hero} on your team`, with: [hero], ...time });
  }
  // "Lina against Axe", "Pudge with Crystal Maiden": the combined slice, first, since it is what was asked.
  const split = String(text || '').split(/\b(against|vs\.?|versus|facing|into|with|alongside)\b/i);
  if (split.length >= 3) {
    const before = heroesInText(split[0], heroes).map(id => heroes[id].name), after = heroesInText(split.slice(2).join(' '), heroes).map(id => heroes[id].name);
    const rel = /^(with|alongside)$/i.test(split[1]) ? 'with' : 'against';
    if (before.length && after.length) out.unshift({ label: `You on ${before[0]} ${rel} ${after.join(' and ')}`, hero: [before[0]], [rel]: after.slice(0, 2), ...time });
  }
  if (!named.length && Object.keys(time).length) out.push({ label: 'Games in the period you asked about', ...time, groupBy: 'hero', limit: 10 });
  return out;
}
