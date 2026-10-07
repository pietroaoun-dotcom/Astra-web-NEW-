// Draft scoring: pure functions. Every score part is a win-rate number with a sample size behind it.
import { shrink } from './heroes.js';
import { fitsRole } from './analysis.js';

const pct = x => Math.round(x * 100) + '%';
const MATCHUP_K = 100; // prior weight in games for matchup win rates (they are noisy at small n)

/**
 * Win rate of `candidate` against `enemy`, from the ENEMY's matchup list (one request per enemy).
 * OpenDota's matchup rows are symmetric: wins(A vs B) + wins(B vs A) = games.
 */
export function versus(candidate, enemyMatchups) {
  const row = (enemyMatchups || []).find(m => m.hero_id === candidate);
  if (!row || !row.games_played) return null;
  const wins = row.games_played - row.wins; // candidate's wins
  return { games: row.games_played, wr: wins / row.games_played, adj: shrink(wins, row.games_played, 0.5, MATCHUP_K) };
}

/**
 * Candidates: your heroes (5+ games), favourites, and the best unplayed meta heroes (marked as new to you).
 * Excludes picked heroes and avoided ones, and respects the role filter.
 */
export function candidatePool({ rows, heroes, prefs, picked, metaOf, extraMeta = 8 }) {
  const taken = new Set(picked), avoided = new Set(prefs.avoided);
  const ok = id => heroes[id] && !taken.has(id) && !avoided.has(id) && fitsRole(heroes[id], prefs.role);
  const mine = new Map(rows.map(r => [r.id, r]));
  const ids = new Set(rows.filter(r => r.g >= 5 && ok(r.id)).map(r => r.id));
  prefs.favorites.filter(ok).forEach(id => ids.add(id));
  const fresh = Object.values(heroes).filter(h => ok(h.id) && !(mine.get(h.id) && mine.get(h.id).g >= 5) && metaOf(h).n >= 2000)
    .sort((a, b) => metaOf(b).wr - metaOf(a).wr).slice(0, extraMeta);
  fresh.forEach(h => ids.add(h.id));
  return [...ids];
}

/**
 * Score each candidate. score = 0.5 * (your adjusted WR - 50%) + 1.5 * (mean matchup edge vs enemies)
 *                               + 0.5 * (bracket meta WR - 50%) + 0.02 if favourite.
 * Weights are judgement calls: matchup edges are small numbers, so they get the largest multiplier.
 * Returns best first, each with reasons and a confidence label.
 */
export function scoreCandidates({ ids, heroes, rows, enemies, matchupsByEnemy, metaOf, prefs }) {
  const mine = new Map(rows.map(r => [r.id, r]));
  const fav = new Set(prefs.favorites);
  return ids.map(id => {
    const r = mine.get(id), hero = heroes[id], mt = metaOf(hero);
    const known = !!(r && r.g >= 5);
    const personal = known ? r.adj - 0.5 : 0;
    const vs = enemies.map(e => ({ enemy: e, v: versus(id, matchupsByEnemy[e]) })).filter(x => x.v);
    const edge = vs.length ? vs.reduce((s, x) => s + (x.v.adj - 0.5), 0) / vs.length : 0;
    const score = 0.5 * personal + 1.5 * edge + 0.5 * (mt.wr - 0.5) + (fav.has(id) ? 0.02 : 0);
    const reasons = [];
    if (known) reasons.push(`You: ${pct(r.wr)} over ${r.g} ${r.recent ? "recent " : ""}games.`); else reasons.push('New to you: no personal record to lean on.');
    for (const { enemy, v } of vs) reasons.push(`Against ${heroes[enemy] ? heroes[enemy].name : enemy}: ${pct(v.wr)} over ${v.games.toLocaleString('en-US')} public games.`);
    if (enemies.length && !vs.length) reasons.push('No matchup data against the enemy picks.');
    reasons.push(`Bracket meta: ${pct(mt.wr)}.`);
    if (fav.has(id)) reasons.push('One of your favourites.');
    const minGames = vs.length ? Math.min(...vs.map(x => x.v.games)) : 0;
    const conf = known && r.g >= 15 && (!enemies.length || (vs.length === enemies.length && minGames >= 500)) ? 'high'
      : known && r.g >= 8 ? 'medium' : 'low';
    return { id, score, known, personalGames: known ? r.g : 0, edge, conf, reasons, vsCount: vs.length };
  }).sort((a, b) => b.score - a.score);
}

const NEED = [
  ['Support', 'Nobody on your team has the Support tag yet.'],
  ['Carry', 'Nobody on your team has the Carry tag yet.'],
  ['Initiator', 'No Initiator tag on your team: engaging fights may be hard.'],
  ['Disabler', 'No Disabler tag on your team: locking down targets may be hard.'],
];

/** Soft team-composition hints from OpenDota role tags. Tags are coarse, so these are hints, not data. */
export function compositionHints(allies, enemies, heroes) {
  const out = [];
  const tags = ids => ids.flatMap(id => (heroes[id] && heroes[id].roles) || []);
  if (allies.length >= 3) {
    const t = tags(allies);
    for (const [tag, msg] of NEED) if (!t.includes(tag)) out.push(msg);
    const melee = allies.filter(id => heroes[id] && heroes[id].attack === 'Melee').length;
    if (melee >= 4) out.push('Almost all your team is melee.');
  }
  if (enemies.length >= 3) {
    const e = tags(enemies);
    const count = tag => e.filter(x => x === tag).length;
    if (count('Escape') >= 3) out.push(`${count('Escape')} enemy heroes have the Escape tag: they may be hard to catch.`);
    if (count('Disabler') >= 3) out.push(`${count('Disabler')} enemy heroes have the Disabler tag: expect plenty of lockdown.`);
  }
  return out;
}
