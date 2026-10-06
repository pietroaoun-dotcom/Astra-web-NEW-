// Pure analysis functions. No DOM, no network: every number shown to the user is computed here.
// Matches use the compact shape from sync.js (t, d, h, s, rw, k, de, a, p, gpm, xpm, ...), newest first.
import { shrink, percentileOf } from './heroes.js';

export const won = m => (m.s < 128) === (m.rw === 1);
export const dpm = m => m.de / (m.d / 60);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
export const avg = (a, f) => (a.length ? sum(a, f) / a.length : 0);
export const winrate = a => (a.length ? a.filter(won).length / a.length : 0);

/** Two-proportion z. Positive when group A wins more than group B. */
export function zTest(wa, na, wb, nb) {
  if (!na || !nb) return 0;
  const p = (wa + wb) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  return se ? (wa / na - wb / nb) / se : 0;
}

/** Confidence label from sample size and how separable the groups are. */
export function confidence(z, n) {
  const a = Math.abs(z);
  if (n < 20) return 'low';
  if (a >= 2) return 'high';
  if (a >= 1.3) return 'medium';
  return 'low';
}
const CONF_WEIGHT = { high: 1, medium: 0.6, low: 0.25 };

/** Rolling win rate over `window` games, oldest to newest. Input newest-first. */
export function rollingWR(matches, window = 20) {
  const asc = [...matches].reverse();
  const out = [];
  for (let i = window - 1; i < asc.length; i++) {
    out.push(winrate(asc.slice(i - window + 1, i + 1)));
  }
  return out;
}

/** Group games into sessions: a gap over `gapHours` starts a new one. Adds session position and previous result. */
export function sessionize(matches, gapHours = 2) {
  const asc = [...matches].sort((a, b) => a.t - b.t);
  let pos = 0, prev = null;
  return asc.map(m => {
    if (!prev || m.t - (prev.t + prev.d) > gapHours * 3600) pos = 1; else pos++;
    const row = { m, pos, prevWon: pos > 1 ? won(prev) : null };
    prev = m;
    return row;
  });
}

export const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const pct = x => Math.round(x * 100) + '%';
const pctOf = (w, n) => (n ? Math.round((w / n) * 100) : 0) + '%';

/**
 * Turn named segments into a fault (worst segment) and a strength (best segment).
 * Impact = win-rate points gained if the weak segment performed at your overall rate
 * (or, for strengths, points the segment currently adds).
 */
function fromSegments(id, segs, all, text) {
  const overall = winrate(all), total = all.length;
  const usable = segs.filter(s => s.n >= 15);
  const out = [];
  if (usable.length < 2) return out;
  for (const s of usable) {
    const w = s.list.filter(won).length;
    const restW = all.filter(won).length - w, restN = total - s.n;
    s.w = w; s.wr = w / s.n; s.z = zTest(w, s.n, restW, restN); s.conf = confidence(s.z, s.n);
  }
  const worst = usable.reduce((a, b) => (b.wr < a.wr ? b : a));
  const best = usable.reduce((a, b) => (b.wr > a.wr ? b : a));
  if (worst.wr < overall - 0.03 && worst.conf !== 'low') {
    out.push({
      id: id + ':fault', kind: 'fault', title: text.fault(worst), n: worst.n, conf: worst.conf,
      impact: (overall - worst.wr) * (worst.n / total) * 100,
      evidence: [`${worst.label}: ${pctOf(worst.w, worst.n)} win rate over ${worst.n} games (${pct(overall)} overall).`,
        ...usable.filter(s => s !== worst).map(s => `${s.label}: ${pctOf(s.w, s.n)} over ${s.n} games.`)],
      why: text.why, drill: text.drill, target: text.target ? text.target(worst, overall) : '',
    });
  }
  if (best.wr > overall + 0.03 && best.conf !== 'low') {
    out.push({
      id: id + ':strength', kind: 'strength', title: text.strength(best), n: best.n, conf: best.conf,
      impact: (best.wr - overall) * (best.n / total) * 100,
      evidence: [`${best.label}: ${pctOf(best.w, best.n)} win rate over ${best.n} games (${pct(overall)} overall).`],
      why: text.strengthWhy || '', drill: '', target: '',
    });
  }
  return out;
}

function deathsInsight(all) {
  const rated = all.filter(m => m.d > 600);
  if (rated.length < 30) return [];
  const sorted = [...rated].sort((a, b) => dpm(a) - dpm(b));
  const cut = dpm(sorted[Math.floor(sorted.length / 2)]);
  const low = rated.filter(m => dpm(m) < cut), high = rated.filter(m => dpm(m) >= cut);
  if (low.length < 15 || high.length < 15) return [];
  const wl = low.filter(won).length, wh = high.filter(won).length;
  const z = zTest(wl, low.length, wh, high.length);
  const conf = confidence(z, Math.min(low.length, high.length));
  const wins = rated.filter(won), losses = rated.filter(m => !won(m));
  const avgDur = avg(rated, m => m.d) / 60;
  const lossDeaths = avg(losses, m => m.de), winDeaths = avg(wins, m => m.de);
  const out = [];
  if (wl / low.length - wh / high.length > 0.03 && conf !== 'low') {
    out.push({
      id: 'deaths:fault', kind: 'fault', title: 'Cut your deaths', n: rated.length, conf,
      // Deaths are partly a symptom of losing, so only count part of the raw gap as achievable.
      impact: (wl / low.length - wh / high.length) * (high.length / rated.length) * 100 * 0.4,
      evidence: [`Games under ${cut.toFixed(2)} deaths/min: ${pctOf(wl, low.length)} win rate (${low.length} games). At or above that: ${pctOf(wh, high.length)} (${high.length} games).`,
        `You average ${lossDeaths.toFixed(1)} deaths in losses and ${winDeaths.toFixed(1)} in wins.`,
        'Caution: part of this gap exists because losing games produce more deaths, so the real gain is smaller than the gap.'],
      why: 'Every death costs time, gold and map pressure, and your results move with it.',
      drill: 'After each death, name the cause in one word (greedy, caught out, forced fight, no vision) and avoid repeating it next life.',
      target: `Average at most ${(cut * avgDur).toFixed(1)} deaths per game (now ${avg(rated, m => m.de).toFixed(1)}).`,
    });
  } else if (wh / high.length - wl / low.length > 0.03 && conf !== 'low') {
    out.push({
      id: 'deaths:aggression', kind: 'strength', title: 'Your aggression pays off', n: rated.length, conf, impact: 0,
      evidence: [`Higher-death games win ${pctOf(wh, high.length)} vs ${pctOf(wl, low.length)} for low-death games.`],
      why: 'Dying more is not hurting you: you trade deaths for pressure.', drill: '', target: '',
    });
  }
  return out;
}

function farmInsight(all, bench) {
  const rated = all.filter(m => m.gpm != null && m.d > 900);
  if (rated.length < 30) return [];
  const byHero = new Map();
  for (const m of rated) { if (!byHero.has(m.h)) byHero.set(m.h, []); byHero.get(m.h).push(m); }
  // Within each hero, "high farm" means above your own average on that hero.
  const hi = [], lo = [];
  for (const list of byHero.values()) {
    if (list.length < 6) continue;
    const mean = avg(list, m => m.gpm);
    list.forEach(m => (m.gpm >= mean ? hi : lo).push(m));
  }
  if (hi.length < 15 || lo.length < 15) return [];
  const wh = hi.filter(won).length, wl = lo.filter(won).length;
  const z = zTest(wh, hi.length, wl, lo.length);
  const conf = confidence(z, Math.min(hi.length, lo.length));
  // Benchmark percentile for heroes with enough games (all-rank benchmarks, so a rough guide).
  const pcts = [];
  for (const [h, list] of byHero) {
    if (list.length >= 10 && bench && bench[h]) {
      const p = percentileOf(bench[h].gold_per_min, avg(list, m => m.gpm));
      if (p != null) pcts.push({ h, p, g: list.length, gpm: avg(list, m => m.gpm) });
    }
  }
  const wp = pcts.length ? sum(pcts, x => x.p * x.g) / sum(pcts, x => x.g) : null;
  if (wh / hi.length - wl / lo.length > 0.05 && conf !== 'low') {
    return [{
      id: 'farm:fault', kind: 'fault', title: 'Farm more consistently', n: rated.length, conf,
      impact: (wh / hi.length - wl / lo.length) * (lo.length / rated.length) * 100 * 0.4,
      evidence: [`Games where you farm above your own average on a hero: ${pctOf(wh, hi.length)} win rate (${hi.length} games). Below: ${pctOf(wl, lo.length)} (${lo.length}).`,
        ...(wp != null ? [`Across your most-played heroes your GPM sits around the ${ordinal(Math.round(wp * 100))} percentile (all-rank benchmarks, rough guide).`] : []),
        'Caution: winning also produces gold, so part of this gap is an effect of the result, not the cause.'],
      why: 'Your best games come with extra farm, and farm is one of the few things you fully control.',
      drill: 'Pick one time check each game (for example 10:00) and compare last hits to your usual; if behind, take the next safe camp wave instead of looking for a fight.',
      target: `Reach your above-average GPM in more games (now ${pctOf(hi.length, hi.length + lo.length)} of games).`,
    }];
  }
  return [];
}

function tiltInsights(all) {
  const rows = sessionize(all);
  const afterLoss = rows.filter(r => r.prevWon === false).map(r => r.m);
  const afterWin = rows.filter(r => r.prevWon === true).map(r => r.m);
  const first = rows.filter(r => r.pos === 1).map(r => r.m);
  const out = [];
  out.push(...fromSegments('tilt', [
    { key: 'afterLoss', label: 'Straight after a loss', list: afterLoss, n: afterLoss.length },
    { key: 'afterWin', label: 'Straight after a win', list: afterWin, n: afterWin.length },
    { key: 'first', label: 'First game of a session', list: first, n: first.length },
  ], all, {
    fault: s => (s.key === 'afterLoss' ? 'You tilt after losses' : 'Your ' + s.label.toLowerCase() + ' results are weak'),
    why: 'The next queue is where tilt shows up. It is a mental pattern you can interrupt.',
    drill: 'After a loss, take a 10 minute break before queueing again. Stand up, drink water, no instant requeue.',
    target: (s, o) => `Bring win rate ${s.label.toLowerCase()} up from ${pctOf(s.w, s.n)} toward your ${pct(o)} average.`,
    strength: s => 'You bounce back well: ' + s.label.toLowerCase(),
    strengthWhy: 'Staying steady between games is a real edge.',
  }));
  const bySession = [1, 2, 3, 4].map(p => {
    const list = rows.filter(r => (p === 4 ? r.pos >= 4 : r.pos === p)).map(r => r.m);
    return { key: 'pos' + p, label: p === 4 ? 'Game 4 or later in a session' : 'Game ' + p + ' of a session', list, n: list.length };
  });
  const late = bySession[3];
  if (late.n >= 15) {
    const w = late.list.filter(won).length, restW = all.filter(won).length - w;
    const z = zTest(w, late.n, restW, all.length - late.n);
    const conf = confidence(z, late.n);
    if (late.list.length && w / late.n < winrate(all) - 0.05 && conf !== 'low') {
      out.push({
        id: 'session:fault', kind: 'fault', title: 'Stop after three games', n: late.n, conf,
        impact: (winrate(all) - w / late.n) * (late.n / all.length) * 100,
        evidence: [`Game 4 or later in a session: ${pctOf(w, late.n)} win rate over ${late.n} games (${pct(winrate(all))} overall).`],
        why: 'Long sessions cost you focus and win rate.',
        drill: 'Set a three-game limit per session, then stop or take a real break.',
        target: 'Fewer games played past game 3 in a session.',
      });
    }
  }
  return out;
}

const bucketOf = h => (h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3);
const BUCKETS = ['Night (00-06)', 'Morning (06-12)', 'Afternoon (12-18)', 'Evening (18-24)'];

function timeInsights(all, hourOf) {
  const segs = BUCKETS.map((label, i) => ({ key: i, label, list: [] }));
  for (const m of all) segs[bucketOf(hourOf(m.t))].list.push(m);
  segs.forEach(s => { s.n = s.list.length; });
  return fromSegments('time', segs, all, {
    fault: s => 'Avoid queueing in the ' + s.label.split(' ')[0].toLowerCase(),
    why: 'Your results depend on when you play, likely energy and focus.',
    drill: 'Shift ranked games to your best time window and use the weak one for unranked or practice.',
    target: (s, o) => `Lift ${s.label.split(' ')[0].toLowerCase()} win rate toward ${pct(o)}, or play fewer ranked games then.`,
    strength: s => 'You play best in the ' + s.label.split(' ')[0].toLowerCase(),
    strengthWhy: 'Queue ranked in this window when you can.',
  });
}

function durationInsights(all) {
  const segs = [
    { key: 's', label: 'Short games (under 30 min)', list: all.filter(m => m.d < 1800) },
    { key: 'm', label: 'Medium games (30-40 min)', list: all.filter(m => m.d >= 1800 && m.d < 2400) },
    { key: 'l', label: 'Long games (40+ min)', list: all.filter(m => m.d >= 2400) },
  ];
  segs.forEach(s => { s.n = s.list.length; });
  return fromSegments('duration', segs, all, {
    fault: s => (s.key === 's' ? 'You lose short games: avoid early fights' : s.key === 'l' ? 'You fade in long games' : 'You stall in mid-length games'),
    why: 'Game length shows where your plan breaks down.',
    drill: 'Review one loss from this length bucket and mark the moment it slipped away (a fight, a lost objective, a missed item).',
    target: (s, o) => `Raise ${s.label.toLowerCase()} win rate from ${pctOf(s.w, s.n)} toward ${pct(o)}.`,
    strength: s => 'You are strong in ' + s.label.toLowerCase(),
    strengthWhy: 'Lean into the game length you win most.',
  });
}

function partyInsights(all) {
  const solo = all.filter(m => m.p <= 1), party = all.filter(m => m.p > 1);
  return fromSegments('party', [
    { key: 'solo', label: 'Solo queue', list: solo, n: solo.length },
    { key: 'party', label: 'In a party', list: party, n: party.length },
  ], all, {
    fault: s => (s.key === 'solo' ? 'Solo queue is dragging you down' : 'Party games underperform'),
    why: 'How you queue changes your results.',
    drill: 'Review three recent losses in the weaker queue type and note what was different (hero, communication, role).',
    target: (s, o) => `Close the gap to your ${pct(o)} average.`,
    strength: s => (s.key === 'solo' ? 'You carry in solo queue' : 'You do better with a party'),
    strengthWhy: 'Queue this way more often.',
  });
}

function poolInsights(all) {
  const counts = new Map();
  for (const m of all) counts.set(m.h, (counts.get(m.h) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = new Set(ranked.slice(0, 3).map(e => e[0]));
  const inPool = all.filter(m => top.has(m.h)), outPool = all.filter(m => !top.has(m.h));
  const out = [];
  if (outPool.length >= 15 && inPool.length >= 15) {
    const wi = inPool.filter(won).length, wo = outPool.filter(won).length;
    const z = zTest(wi, inPool.length, wo, outPool.length), conf = confidence(z, outPool.length);
    if (wi / inPool.length - wo / outPool.length > 0.04 && conf !== 'low') {
      out.push({
        id: 'pool:fault', kind: 'fault', title: 'Narrow your hero pool', n: all.length, conf,
        impact: (wi / inPool.length - wo / outPool.length) * (outPool.length / all.length) * 100,
        evidence: [`Your top 3 heroes: ${pctOf(wi, inPool.length)} win rate (${inPool.length} games). Everything else: ${pctOf(wo, outPool.length)} (${outPool.length} games).`,
          `You have played ${counts.size} different heroes in ${all.length} games.`],
        why: 'Heroes outside your core cost you games.',
        drill: 'Pick your top 3 as a default and only step outside when the draft forces it.',
        target: `Play at least ${Math.round((inPool.length / all.length) * 100 + 10)}% of games on your top 3.`,
      });
    }
  }
  return out;
}

function trendInsight(all) {
  if (all.length < 60) return [];
  const recent = all.slice(0, 30), prior = all.slice(30, 60);
  const wr = winrate(recent), wp = winrate(prior);
  const z = zTest(recent.filter(won).length, 30, prior.filter(won).length, 30);
  const conf = confidence(z, 30);
  const d = wr - wp;
  if (Math.abs(d) < 0.1) return [];
  const up = d > 0;
  return [{
    id: 'trend:' + (up ? 'strength' : 'fault'), kind: up ? 'strength' : 'fault',
    title: up ? 'You are on an upswing' : 'Your results are sliding', n: 60, conf,
    impact: Math.abs(d) * 30,
    evidence: [`Last 30 games: ${pct(wr)} win rate. Previous 30: ${pct(wp)}.`],
    why: up ? 'Whatever you changed recently is working.' : 'Something shifted recently. Check hero picks, session length and time of day.',
    drill: up ? '' : 'Compare your last 10 losses: is there a repeating hero, time of day or party setup?',
    target: up ? '' : `Return the rolling win rate to ${pct(wp)}.`,
  }];
}

/**
 * Build the ranked list of insights. ctx: { bench: {heroId: benchmarkResult}, hourOf: ts => local hour }.
 * Faults are ranked by impact weighted by confidence; strengths follow.
 */
export function buildInsights(matches, ctx = {}) {
  const all = matches.filter(m => m.d > 300);
  const hourOf = ctx.hourOf || (t => new Date(t * 1000).getHours());
  if (all.length < 30) return [];
  const list = [
    ...deathsInsight(all), ...farmInsight(all, ctx.bench), ...tiltInsights(all), ...timeInsights(all, hourOf),
    ...durationInsights(all), ...partyInsights(all), ...poolInsights(all), ...trendInsight(all),
  ];
  const score = i => i.impact * CONF_WEIGHT[i.conf];
  const faults = list.filter(i => i.kind === 'fault').sort((a, b) => score(b) - score(a));
  const strengths = list.filter(i => i.kind === 'strength').sort((a, b) => score(b) - score(a));
  return [...faults, ...strengths];
}

// ---------- trends, hero form, per-game notes, pick recommendations ----------

/** Rolling mean of f over `window` games, oldest to newest, last `limit` points. Input newest-first. */
export function rollingAvg(matches, f, window = 20, limit = 100) {
  const asc = [...matches].reverse(), out = [];
  for (let i = window - 1; i < asc.length; i++) {
    const w = asc.slice(i - window + 1, i + 1).map(f).filter(v => v != null && Number.isFinite(v));
    out.push(w.length ? w.reduce((s, v) => s + v, 0) / w.length : null);
  }
  return out.slice(-limit);
}

/** Last 30 games against the 30 before, for the metrics that move results. Needs 60+ games. */
export function trends(matches) {
  const all = matches.filter(m => m.d > 600);
  if (all.length < 60) return [];
  const cur = all.slice(0, 30), prev = all.slice(30, 60);
  const defs = [
    { key: 'wr', label: 'Win rate', f: m => (won(m) ? 1 : 0), good: 'up', flat: 0.04, fmt: v => pct(v), unit: '' },
    { key: 'dpm', label: 'Deaths per minute', f: dpm, good: 'down', flat: 0.12, fmt: v => v.toFixed(2), unit: '' },
    { key: 'gpm', label: 'GPM', f: m => m.gpm, good: 'up', flat: 0.05, fmt: v => String(Math.round(v)), unit: '' },
    { key: 'kda', label: 'KDA ratio', f: m => (m.k + m.a) / Math.max(1, m.de), good: 'up', flat: 0.1, fmt: v => v.toFixed(1), unit: '' },
  ];
  return defs.map(d => {
    const now = avg(cur.filter(m => d.f(m) != null), d.f), before = avg(prev.filter(m => d.f(m) != null), d.f);
    const rel = before ? (now - before) / Math.abs(before) : 0;
    const change = Math.abs(d.key === 'wr' ? now - before : rel) < d.flat ? 'flat' : ((now > before) === (d.good === 'up') ? 'better' : 'worse');
    return { key: d.key, label: d.label, now: d.fmt(now), before: d.fmt(before), change, series: rollingAvg(all, d.f, 20, 100), n: 30 };
  });
}

/** Heroes whose last 10 games differ a lot from their longer record. */
export function heroForm(matches, heroes, minRecent = 8, minTotal = 20) {
  const by = new Map();
  for (const m of matches) { if (!by.has(m.h)) by.set(m.h, []); by.get(m.h).push(m); }
  const out = [];
  for (const [id, list] of by) {
    if (list.length < minTotal) continue;
    const recent = list.slice(0, 10), older = list.slice(10);
    if (recent.length < minRecent || older.length < 10) continue;
    const r = winrate(recent), o = winrate(older);
    if (Math.abs(r - o) >= 0.2) out.push({ id, name: heroes[id] ? heroes[id].name : 'Hero ' + id, recentN: recent.length, recentWR: r, olderN: older.length, olderWR: o, delta: r - o });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);
}

/** What stood out in one game, measured against the player's own norms. matches = all, newest first. */
export function matchNotes(m, matches, heroes) {
  const others = matches.filter(x => x.id !== m.id && x.d > 600);
  const same = others.filter(x => x.h === m.h);
  const recent = others.slice(0, 50);
  const name = heroes[m.h] ? heroes[m.h].name : 'this hero';
  const out = [];
  const base = same.length >= 5 ? same : recent, baseLabel = same.length >= 5 ? 'on ' + name : 'overall';
  if (m.d > 600 && base.length) {
    const d = dpm(m), usual = avg(base, dpm);
    if (d > usual * 1.3) out.push({ tone: 'bad', text: `Died ${m.de} times (${d.toFixed(2)}/min), more than your usual ${usual.toFixed(2)}/min ${baseLabel}.` });
    else if (d < usual * 0.7) out.push({ tone: 'good', text: `Only ${m.de} deaths (${d.toFixed(2)}/min), cleaner than your usual ${usual.toFixed(2)}/min ${baseLabel}.` });
  }
  if (m.gpm != null && base.filter(x => x.gpm != null).length) {
    const usual = avg(base.filter(x => x.gpm != null), x => x.gpm);
    if (m.gpm > usual * 1.15) out.push({ tone: 'good', text: `${m.gpm} GPM, well above your usual ${Math.round(usual)} ${baseLabel}.` });
    else if (m.gpm < usual * 0.85) out.push({ tone: 'bad', text: `${m.gpm} GPM, well below your usual ${Math.round(usual)} ${baseLabel}.` });
  }
  if (recent.length) {
    const len = avg(recent, x => x.d);
    if (m.d > len * 1.35) out.push({ tone: 'info', text: `A long game (${Math.round(m.d / 60)} min against your ${Math.round(len / 60)} min average).` });
    else if (m.d < len * 0.65) out.push({ tone: 'info', text: `A short game (${Math.round(m.d / 60)} min against your ${Math.round(len / 60)} min average).` });
  }
  const sorted = [...matches].sort((a, b) => a.t - b.t), i = sorted.findIndex(x => x.id === m.id);
  if (i > 0) {
    const prev = sorted[i - 1], gap = m.t - (prev.t + prev.d);
    if (gap < 20 * 60 && !won(prev)) out.push({ tone: 'info', text: `Queued ${Math.max(0, Math.round(gap / 60))} min after a loss. Your results after losses are in the coach plan.` });
    let streak = 0;
    for (let j = i - 1; j >= 0 && !won(sorted[j]) && m.t - sorted[j].t < 8 * 3600; j--) streak++;
    if (streak >= 2) out.push({ tone: 'bad', text: `This came after ${streak} losses in a row.` });
  }
  if (same.length >= 5) out.push({ tone: 'info', text: `${name}: ${same.filter(won).length} wins in ${same.length} earlier games.` });
  return out;
}

/** Who to play and who to stop playing, from long-run results, recent form, meta and preferences. */
export function pickRecommendations(rows, matches, heroes, prefs, metaOf) {
  const avoided = new Set(prefs.avoided), fav = new Set(prefs.favorites);
  const overallDpm = avg(matches.filter(m => m.d > 600), dpm);
  const score = r => {
    const recent = matches.filter(m => m.h === r.id).slice(0, 10);
    const recentWR = recent.length >= 6 ? winrate(recent) : null;
    // Ten games are noisy: pull recent form toward the long-run rate before it counts.
    const recentAdj = recentWR != null ? shrink(recent.filter(won).length, recent.length, r.wr, 10) : null;
    return { recent, recentWR, s: (r.adj - 0.5) + (recentAdj != null ? 0.3 * (recentAdj - r.wr) : 0) + 0.3 * (r.meta - 0.5) + (fav.has(r.id) ? 0.03 : 0) };
  };
  const reasons = (r, sc) => {
    const out = [`${pct(r.wr)} over ${r.g} games (${pct(r.meta)} for the bracket).`];
    if (sc.recentWR != null) out.push(`Last ${sc.recent.length} games: ${pct(sc.recentWR)}.`);
    if (r.dpm && overallDpm && r.dpm < overallDpm * 0.8) out.push(`You die less on this hero (${r.dpm.toFixed(2)}/min against ${overallDpm.toFixed(2)} overall).`);
    if (r.dpm && overallDpm && r.dpm > overallDpm * 1.25) out.push(`You die more on this hero (${r.dpm.toFixed(2)}/min against ${overallDpm.toFixed(2)} overall).`);
    if (fav.has(r.id)) out.push('One of your favourites.');
    return out;
  };
  const eligible = rows.filter(r => r.g >= 8).map(r => { const sc = score(r); return { id: r.id, g: r.g, wr: r.wr, adj: r.adj, ...sc, reasons: reasons(r, sc), conf: r.g >= 40 ? 'high' : r.g >= 20 ? 'medium' : 'low' }; });
  const play = eligible.filter(r => !avoided.has(r.id) && fitsRole(heroes[r.id], prefs.role) && r.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
  const stop = eligible.filter(r => r.g >= 12 && r.adj < 0.49 && !fav.has(r.id)).sort((a, b) => a.s - b.s).slice(0, 4);
  return { play, stop };
}

/** Per-hero table: games, win rate, shrunk win rate vs bracket meta, KDA, GPM, deaths per minute. */
export function heroTable(matches, heroes, metaOf) {
  const by = new Map();
  for (const m of matches) { if (!by.has(m.h)) by.set(m.h, []); by.get(m.h).push(m); }
  return [...by.entries()].map(([id, list]) => {
    const g = list.length, w = list.filter(won).length;
    const mt = metaOf(heroes[id]);
    return {
      id, g, w, wr: w / g, meta: mt.wr, metaN: mt.n, adj: shrink(w, g, mt.wr),
      k: avg(list, m => m.k), de: avg(list, m => m.de), a: avg(list, m => m.a),
      gpm: avg(list.filter(m => m.gpm != null), m => m.gpm), xpm: avg(list.filter(m => m.xpm != null), m => m.xpm),
      dpm: avg(list.filter(m => m.d > 600), dpm), last: Math.max(...list.map(m => m.t)),
    };
  });
}

/** Does this hero fit the chosen role? Mid has no hero-level tag in OpenDota, so it filters nothing. */
export function fitsRole(hero, role) {
  if (!role || role === 'mid' || !hero) return true;
  const r = hero.roles || [];
  return role === 'carry' ? r.includes('Carry') : role === 'support' ? r.includes('Support') : true;
}

/** Heroes to lean on, limit and learn, respecting favourites, avoided heroes and role. */
export function heroLists(rows, heroes, prefs, metaOf, playedIds) {
  const avoided = new Set(prefs.avoided), fav = new Set(prefs.favorites);
  const ok = r => !avoided.has(r.id) && fitsRole(heroes[r.id], prefs.role);
  const lean = rows.filter(r => r.g >= 8 && ok(r))
    .map(r => ({ ...r, score: r.adj + (fav.has(r.id) ? 0.03 : 0) })).sort((a, b) => b.score - a.score).slice(0, 6);
  // Limit: heroes you keep playing that lose. Avoided heroes are still shown here as "stop playing".
  const limit = rows.filter(r => r.g >= 10 && r.adj < 0.5 && !fav.has(r.id)).sort((a, b) => a.adj - b.adj).slice(0, 4);
  const metas = Object.values(heroes).map(h => metaOf(h).n).sort((a, b) => a - b);
  const median = metas[Math.floor(metas.length / 2)] || 0;
  const learn = Object.values(heroes)
    .filter(h => (playedIds.get(h.id) || 0) < 5 && metaOf(h).n >= median && !avoided.has(h.id) && fitsRole(h, prefs.role))
    .map(h => ({ id: h.id, meta: metaOf(h).wr, metaN: metaOf(h).n, fav: fav.has(h.id) }))
    .sort((a, b) => b.meta + (b.fav ? 0.03 : 0) - (a.meta + (a.fav ? 0.03 : 0))).slice(0, 6);
  return { lean, limit, learn };
}
