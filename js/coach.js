// Coaching engine: current form, period summaries, roles, heroes to try, hero training plans, weekly strategy.
// Pure functions over the compact match shape from sync.js (newest first). Every number comes from the data.
import { won, dpm, avg, winrate, zTest, confidence, heroTable, fitsRole } from './analysis.js';
import { shrink, percentileOf } from './heroes.js';

const DAY = 86400;
const pct = x => Math.round(x * 100) + '%';

/**
 * The player you are now: games from the last 180 days. If that is under 60 games, the last 150 games instead.
 * All coaching uses this window; all-time numbers are shown only as context.
 */
export function formWindow(matches, nowSec = Date.now() / 1000) {
  const recent = matches.filter(m => nowSec - m.t <= 180 * DAY);
  if (recent.length >= 60) return { list: recent, label: `last 180 days (${recent.length} games)`, short: 'last 180 days' };
  const list = matches.slice(0, 150);
  return { list, label: `last ${list.length} games`, short: `last ${list.length} games` };
}

// ---------- periods ----------

export const PERIODS = [
  ['day', 'Today', 'Yesterday'], ['week', 'This week', 'Last week'], ['month', 'This month', 'Last month'],
  ['year', 'This year', 'Last year'], ['all', 'All time', null],
];

/** Calendar period boundaries in local time (unix seconds). The week starts on Monday. */
export function periodRange(kind, now = new Date()) {
  const d = new Date(now);
  let start, prevStart;
  if (kind === 'day') { start = new Date(d.getFullYear(), d.getMonth(), d.getDate()); prevStart = new Date(start); prevStart.setDate(start.getDate() - 1); }
  else if (kind === 'week') { const back = (d.getDay() + 6) % 7; start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back); prevStart = new Date(start); prevStart.setDate(start.getDate() - 7); }
  else if (kind === 'month') { start = new Date(d.getFullYear(), d.getMonth(), 1); prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1); }
  else if (kind === 'year') { start = new Date(d.getFullYear(), 0, 1); prevStart = new Date(d.getFullYear() - 1, 0, 1); }
  else return { start: 0, end: Infinity, prevStart: null, prevEnd: null };
  return { start: start / 1000, end: Infinity, prevStart: prevStart / 1000, prevEnd: start / 1000 };
}

export const inRange = (matches, from, to) => matches.filter(m => m.t >= from && m.t < to);

/** Totals and averages for a set of games. */
export function periodStats(list) {
  if (!list.length) return { games: 0 };
  const w = list.filter(won).length, rated = list.filter(m => m.d > 600);
  const byHero = new Map();
  for (const m of list) { const h = byHero.get(m.h) || { id: m.h, g: 0, w: 0 }; h.g++; if (won(m)) h.w++; byHero.set(m.h, h); }
  const score = m => (m.k + m.a) / Math.max(1, m.de) + (won(m) ? 2 : 0) + (m.gpm || 0) / 400;
  const sorted = [...list].sort((a, b) => score(b) - score(a));
  let streak = 0;
  const first = won(list[0]);
  for (const m of list) { if (won(m) === first) streak++; else break; }
  return {
    games: list.length, wins: w, losses: list.length - w, wr: w / list.length,
    minutes: list.reduce((s, m) => s + m.d / 60, 0),
    k: avg(list, m => m.k), de: avg(list, m => m.de), a: avg(list, m => m.a),
    kda: avg(list, m => (m.k + m.a) / Math.max(1, m.de)),
    gpm: avg(list.filter(m => m.gpm != null), m => m.gpm), dpm: avg(rated, dpm),
    heroes: [...byHero.values()].sort((a, b) => b.g - a.g),
    best: sorted[0], worst: sorted[sorted.length - 1],
    streak: { n: streak, won: first },
  };
}

/** Summary cards for the home page: each period, the period before, and a one-line verdict. */
export function summaryCards(matches, baseline, now = new Date()) {
  return PERIODS.map(([kind, label, prevLabel]) => {
    const r = periodRange(kind, now);
    const cur = periodStats(inRange(matches, r.start, r.end));
    const prev = r.prevStart != null ? periodStats(inRange(matches, r.prevStart, r.prevEnd)) : null;
    return { kind, label, prevLabel, cur, prev, verdict: periodVerdict(cur, baseline, kind) };
  });
}

/** Short coach's verdict for a period against the player's current form. */
export function periodVerdict(s, base, kind = 'day') {
  if (!s.games) return kind === 'day' ? 'No ranked games yet today.' : 'No ranked games in this period.';
  const out = [];
  if (base && base.games) {
    const d = s.wr - base.wr;
    if (s.games >= 3 && Math.abs(d) >= 0.08) out.push(d > 0 ? `Winning more than your usual ${pct(base.wr)}.` : `Below your usual ${pct(base.wr)}.`);
    if (s.dpm && base.dpm) {
      if (s.dpm < base.dpm * 0.85) out.push('Dying less than usual.');
      else if (s.dpm > base.dpm * 1.2) out.push('Dying more than usual.');
    }
    if (s.gpm && base.gpm && s.gpm > base.gpm * 1.08) out.push('Farming above your average.');
  }
  if (s.streak.n >= 3) out.push(`${s.streak.n} ${s.streak.won ? 'wins' : 'losses'} in a row right now.`);
  return out.slice(0, 2).join(' ') || 'In line with your usual level.';
}

// ---------- roles ----------

/**
 * Role per game, estimated from last hits per minute (OpenDota has no role for most games): under 2.5 per
 * minute is played as a support, otherwise as a core. Cores are split by the hero's Carry tag.
 */
export function gameRole(m, heroes) {
  if (m.lh == null || m.d < 900) return null;
  if (m.lh / (m.d / 60) < 2.5) return 'support';
  const h = heroes[m.h];
  return h && (h.roles || []).includes('Carry') ? 'carry' : 'core';
}

export const ROLE_LABELS = { carry: 'Core (carry heroes)', core: 'Core (mid / offlane heroes)', support: 'Support' };

export function roleReport(list, heroes) {
  const overall = winrate(list);
  const groups = { carry: [], core: [], support: [] };
  for (const m of list) { const r = gameRole(m, heroes); if (r) groups[r].push(m); }
  const roles = Object.entries(groups).map(([key, g]) => {
    const w = g.filter(won).length;
    return { key, label: ROLE_LABELS[key], g: g.length, w, wr: g.length ? w / g.length : 0, adj: shrink(w, g.length, overall, 10), dpm: avg(g.filter(m => m.d > 600), dpm), kda: avg(g, m => (m.k + m.a) / Math.max(1, m.de)) };
  });
  const coreG = groups.carry.concat(groups.core), supG = groups.support;
  const cw = coreG.filter(won).length, sw = supG.filter(won).length;
  let advice;
  if (coreG.length >= 15 && supG.length >= 15) {
    const z = zTest(cw, coreG.length, sw, supG.length), conf = confidence(z, Math.min(coreG.length, supG.length));
    const coreBetter = cw / coreG.length >= sw / supG.length;
    const [a, b] = coreBetter ? ['core', 'support'] : ['support', 'core'];
    advice = { role: a, conf, text: `Queue ${a}: ${pct(coreBetter ? cw / coreG.length : sw / supG.length)} over ${coreBetter ? coreG.length : supG.length} games, against ${pct(coreBetter ? sw / supG.length : cw / coreG.length)} as ${b}.` + (conf === 'low' ? ' The gap is small, so either role is fine.' : '') };
  } else if (coreG.length >= 15) {
    advice = { role: 'core', conf: 'medium', text: `Queue core: ${pct(cw / coreG.length)} over ${coreG.length} games. Too few support games (${supG.length}) to compare.` };
  } else if (supG.length >= 15) {
    advice = { role: 'support', conf: 'medium', text: `Queue support: ${pct(sw / supG.length)} over ${supG.length} games. Too few core games (${coreG.length}) to compare.` };
  } else advice = { role: null, conf: 'low', text: 'Not enough recent games to recommend a role yet.' };
  // Within core: carry heroes against mid/offlane heroes.
  const [ca, co] = [roles[0], roles[1]];
  if (ca.g >= 12 && co.g >= 12 && Math.abs(ca.wr - co.wr) >= 0.06) advice.sub = `Within core you do better on ${ca.wr > co.wr ? 'carry heroes' : 'mid/offlane heroes'} (${pct(Math.max(ca.wr, co.wr))} against ${pct(Math.min(ca.wr, co.wr))}).`;
  return { roles, advice, estimated: true };
}

// ---------- heroes ----------

/** Recent-form hero table with the all-time record as the prior, so a strong history still counts a little. */
export function formHeroTable(formList, allRows, heroes, metaOf) {
  const all = new Map(allRows.map(r => [r.id, r]));
  return heroTable(formList, heroes, metaOf).map(r => {
    const a = all.get(r.id);
    const prior = a ? a.adj : r.meta;
    return { ...r, adj: shrink(r.w, r.g, prior, 8), allG: a ? a.g : r.g, allWr: a ? a.wr : r.wr };
  });
}

/** Unplayed heroes that play like your best recent heroes and are strong in your bracket. */
export function heroesToTry(formRows, allRows, heroes, prefs, metaOf) {
  const avoided = new Set(prefs.avoided);
  const played = new Map(allRows.map(r => [r.id, r.g]));
  const seeds = formRows.filter(r => r.g >= 5).sort((a, b) => b.adj - a.adj).slice(0, 3).map(r => heroes[r.id]).filter(Boolean);
  if (!seeds.length) return [];
  const metas = Object.values(heroes).map(h => metaOf(h).n).sort((a, b) => a - b);
  const median = metas[Math.floor(metas.length / 2)] || 0;
  const sim = (a, b) => (a.roles || []).filter(r => (b.roles || []).includes(r)).length + (a.primary === b.primary ? 1 : 0) + (a.attack === b.attack ? 1 : 0);
  return Object.values(heroes)
    .filter(h => (played.get(h.id) || 0) < 5 && !avoided.has(h.id) && fitsRole(h, prefs.role) && metaOf(h).n >= median)
    .map(h => {
      const best = seeds.map(s => ({ s, v: sim(h, s) })).sort((a, b) => b.v - a.v)[0];
      const mt = metaOf(h);
      return { id: h.id, like: best.s, simScore: best.v, meta: mt.wr, metaN: mt.n, score: best.v * 0.02 + (mt.wr - 0.5) };
    })
    .filter(x => x.simScore >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => {
      const h = heroes[x.id], shared = (h.roles || []).filter(r => (x.like.roles || []).includes(r)).slice(0, 3);
      return { ...x, reasons: [`Plays like ${x.like.name}${shared.length ? ' (' + shared.join(', ') + ')' : ''}, one of your best heroes right now.`, `${pct(x.meta)} win rate in your bracket over ${x.metaN.toLocaleString('en-US')} public games.`] };
    });
}

// ---------- hero training plan ----------

const TRIVIAL = new Set(['tango', 'flask', 'clarity', 'faerie_fire', 'enchanted_mango', 'branches', 'ward_observer', 'ward_sentry', 'tpscroll', 'smoke_of_deceit', 'dust', 'blood_grenade', 'ward_dispenser', 'magic_stick', 'circlet', 'slippers', 'mantle', 'gauntlets', 'recipe', 'quelling_blade', 'boots', 'ring_of_protection', 'sobi_mask', 'blades_of_attack', 'robe', 'belt_of_strength', 'blade_of_alacrity', 'staff_of_wizardry', 'ogre_axe', 'chainmail', 'cloak', 'fluffy_hat', 'gloves', 'ring_of_regen', 'wind_lace', 'crown', 'broadsword', 'blitz_knuckles', 'mithril_hammer', 'point_booster', 'vitality_booster', 'energy_booster', 'ultimate_orb', 'void_stone', 'platemail', 'talisman_of_evasion', 'hyperstone', 'demon_edge', 'eagle', 'reaver', 'relic', 'mystic_staff', 'javelin', 'quarterstaff', 'helm_of_iron_will', 'lifesteal', 'shadow_amulet', 'ghost', 'tiara_of_selemene', 'cornucopia', 'claymore', 'soul_booster', 'diadem', 'gem']);

/** Most-bought items per phase from OpenDota itemPopularity, with names and icons. */
export function itemBuild(pop, itemIds, items) {
  if (!pop || !itemIds || !items) return [];
  const phases = [['start_game_items', 'Starting items'], ['early_game_items', 'Early game'], ['mid_game_items', 'Mid game'], ['late_game_items', 'Late game']];
  return phases.map(([k, label]) => {
    const list = Object.entries(pop[k] || {}).map(([id, n]) => ({ key: itemIds[id], n })).filter(x => x.key && items[x.key]);
    const keep = k === 'start_game_items' ? list : list.filter(x => !TRIVIAL.has(x.key) && !x.key.startsWith('recipe'));
    return { label, items: keep.sort((a, b) => b.n - a.n).slice(0, 6).map(x => ({ key: x.key, name: items[x.key].dname || x.key, cost: items[x.key].cost || 0, img: items[x.key].img || '', n: x.n })) };
  }).filter(p => p.items.length);
}

/** Targets from OpenDota's hero benchmarks against the player's recent averages on the hero. */
export function trainingTargets(heroMatches, bench) {
  if (!bench) return [];
  const rated = heroMatches.filter(m => m.d > 900);
  if (!rated.length) return [];
  const per = f => avg(rated.filter(m => f(m) != null), f);
  const defs = [
    ['gold_per_min', 'Gold per minute', per(m => m.gpm), 0],
    ['xp_per_min', 'XP per minute', per(m => m.xpm), 0],
    ['last_hits_per_min', 'Last hits per minute', per(m => (m.lh == null ? null : m.lh / (m.d / 60))), 1],
    ['hero_damage_per_min', 'Hero damage per minute', per(m => (m.hd == null ? null : m.hd / (m.d / 60))), 0],
  ];
  return defs.filter(([k, , v]) => bench[k] && bench[k].length && v).map(([k, label, you, dp]) => {
    const p = percentileOf(bench[k], you);
    const goal = Math.min(0.9, Math.max(0.6, p + 0.15));
    const row = bench[k].reduce((best, r) => (Math.abs(r.percentile - goal) < Math.abs(best.percentile - goal) ? r : best), bench[k][0]);
    return { key: k, label, you: +you.toFixed(dp), pct: p, target: +(+row.value).toFixed(dp), targetPct: row.percentile, gap: row.value - you, dp };
  });
}

export const ytSearch = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);

/** Practice steps for a hero, built from the targets (numbers) plus standard practice methods. */
export function heroDrills(heroName, targets, row) {
  const t = Object.fromEntries(targets.map(x => [x.key, x]));
  const out = [];
  if (t.last_hits_per_min && t.last_hits_per_min.gap > 0.3) out.push(`Last hitting: 10 minutes in Demo Hero mode as ${heroName} twice a week. Your games average ${t.last_hits_per_min.you} last hits per minute; ${t.last_hits_per_min.target} puts you at the ${Math.round(t.last_hits_per_min.targetPct * 100)}th percentile.`);
  if (t.gold_per_min && t.gold_per_min.gap > 30) out.push(`Farm route: after laning, never walk without a target camp or wave. Aim for ${t.gold_per_min.target} GPM (you average ${t.gold_per_min.you}).`);
  if (t.hero_damage_per_min && t.hero_damage_per_min.gap > 60) out.push(`Fight presence: join fights where your team has numbers, and stay at max range. Target ${t.hero_damage_per_min.target} hero damage per minute (you: ${t.hero_damage_per_min.you}).`);
  if (row && row.dpm > 0.17) out.push(`Survival: you die ${row.dpm.toFixed(2)} times per minute on ${heroName}. Before each fight, check where the enemy disablers are and keep a way out.`);
  out.push(`Watch one full game of a high-MMR ${heroName} player and pause at 10, 20 and 30 minutes to compare items and last hits with yours.`);
  return out;
}

// ---------- weekly strategy ----------

/** A short, concrete plan for the week, assembled from the analysis (no invented numbers). */
export function weeklyStrategy({ insights, roles, recs, toTry, prefs, heroes }) {
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  const points = [];
  if (roles && roles.advice.role) points.push({ k: 'Queue', v: roles.advice.text + (roles.advice.sub ? ' ' + roles.advice.sub : '') });
  if (recs.play.length) points.push({ k: 'Hero pool', v: `Main ${recs.play.slice(0, 3).map(r => name(r.id)).join(', ')}.` + (recs.stop.length ? ` Bench ${recs.stop.slice(0, 2).map(r => name(r.id)).join(' and ')} for now.` : '') });
  const focus = insights.find(i => i.kind === 'fault');
  if (focus) points.push({ k: 'Focus', v: `${focus.title}. ${focus.target || focus.drill}` });
  const tilt = insights.find(i => /^(tilt|session):fault/.test(i.id));
  points.push({ k: 'Sessions', v: tilt ? tilt.drill : 'Stop after two losses in a row, and take a 5 minute break between games.' });
  if (toTry.length) points.push({ k: 'Try', v: `Learn ${name(toTry[0].id)} in unranked: it plays like ${toTry[0].like.name}.` });
  const goal = prefs.goal ? `Goal: ${prefs.goal}. ` : '';
  return { headline: goal + (focus ? `This week is about one thing: ${focus.title.toLowerCase()}.` : 'Keep doing what works and widen your pool carefully.'), points };
}
