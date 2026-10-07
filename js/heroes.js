// Hero catalogue, bracket meta and benchmark helpers.
import { get } from './api.js';
import { cached, putCache } from './store.js';

const DAY = 864e5;

/** Slimmed heroStats keyed by id. Per-bracket picks/wins are arrays indexed 1..8. */
export async function loadHeroes() {
  let list = cached('heroes', DAY);
  if (list && !list[0].key) list = null; // cache from before `key` existed
  if (!list) {
    const raw = await get('heroStats');
    list = raw.map(h => ({
      id: h.id, key: h.name, name: h.localized_name, primary: h.primary_attr, attack: h.attack_type, roles: h.roles,
      img: h.img, icon: h.icon,
      picks: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(b => h[b + '_pick'] || 0),
      wins: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(b => h[b + '_win'] || 0),
    }));
    putCache('heroes', list);
  }
  const map = {};
  list.forEach(h => { map[h.id] = h; });
  return map;
}

/** Medal (1..8) from rank_tier, or null if unranked/unknown. */
export const bracketOf = rankTier => (rankTier ? Math.min(8, Math.floor(rankTier / 10)) : null);

/** Public-match win rate and pick count for a hero in a bracket (all brackets if null). */
export function meta(hero, bracket) {
  if (!hero) return { wr: 0.5, n: 0 };
  const bs = bracket ? [bracket] : [1, 2, 3, 4, 5, 6, 7, 8];
  let w = 0, n = 0;
  for (const b of bs) { w += hero.wins[b]; n += hero.picks[b]; }
  return { wr: n ? w / n : 0.5, n };
}

/** Raw win rate pulled toward the bracket average; k is the prior weight in games. */
export const shrink = (wins, games, prior, k = 10) => (wins + k * prior) / (games + k);

/** Percentile (0..1) of `value` within OpenDota benchmark rows [{percentile,value}], interpolated. */
export function percentileOf(rows, value) {
  if (!rows || !rows.length) return null;
  if (value <= rows[0].value) return Math.max(0, rows[0].percentile * (value / rows[0].value));
  for (let i = 1; i < rows.length; i++) {
    if (value <= rows[i].value) {
      const a = rows[i - 1], b = rows[i];
      return a.percentile + (b.percentile - a.percentile) * ((value - a.value) / (b.value - a.value || 1));
    }
  }
  return rows[rows.length - 1].percentile;
}

export async function loadBenchmark(heroId) {
  const key = 'bench:' + heroId;
  let b = cached(key, 7 * DAY);
  if (!b) { b = (await get('benchmarks?hero_id=' + heroId)).result; putCache(key, b); }
  return b;
}

export async function loadMatchups(heroId) {
  const key = 'mu:' + heroId;
  let m = cached(key, 3 * DAY);
  if (!m) { m = await get('heroes/' + heroId + '/matchups'); putCache(key, m); }
  return m;
}

/** Item constants slimmed to what the build view needs: id -> key, key -> { dname, cost, img }. */
export async function loadItems() {
  let v = cached('items', 7 * DAY);
  if (!v) {
    const [ids, items] = await Promise.all([get('constants/item_ids'), get('constants/items')]);
    const slimItems = {};
    for (const [k, it] of Object.entries(items)) slimItems[k] = { dname: it.dname, cost: it.cost, img: it.img };
    v = { ids, items: slimItems };
    putCache('items', v);
  }
  return v;
}

export async function loadItemPopularity(heroId) {
  const key = 'pop:' + heroId;
  let p = cached(key, 3 * DAY);
  if (!p) { p = await get('heroes/' + heroId + '/itemPopularity'); putCache(key, p); }
  return p;
}
