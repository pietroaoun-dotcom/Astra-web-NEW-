// Account preview and incremental ranked-match sync.
import { get, ApiError, projectQuery } from './api.js';
import { store } from './store.js';

const RANKED = 'lobby_type=7';

/** Lightweight look at the account before committing to a sync. */
export async function previewAccount(id) {
  const notFound = () => new ApiError('notfound', 'No OpenDota profile for ID ' + id + '. Check the ID, and that you\'ve opened your profile on opendota.com at least once.');
  let player, all, ranked;
  try {
    [player, all, ranked] = await Promise.all([
      get('players/' + id), get('players/' + id + '/wl'), get('players/' + id + '/wl?' + RANKED),
    ]);
  } catch (e) { throw e.kind === 'notfound' ? notFound() : e; }
  if (!player || !player.profile) throw notFound();
  const allGames = all.win + all.lose, rankedGames = ranked.win + ranked.lose;
  let state = 'ok';
  if (!allGames) state = 'private';       // nothing visible at all: usually "Expose Public Match Data" is off
  else if (!rankedGames) state = 'noranked';
  return {
    id, name: player.profile.personaname || 'Player ' + id, avatar: player.profile.avatarmedium || '',
    rankTier: player.rank_tier || null, rankedGames, allGames, wins: ranked.win, state,
  };
}

export const loadLocal = id => store.get('matches:' + id, { id, matches: [], syncedAt: 0 });

/** Compact a raw API row. */
export const slim = m => ({
  id: m.match_id, t: m.start_time, d: m.duration, h: m.hero_id, s: m.player_slot, rw: m.radiant_win ? 1 : 0,
  k: m.kills, de: m.deaths, a: m.assists, p: m.party_size ?? 1, gm: m.game_mode, ar: m.average_rank ?? null,
  gpm: m.gold_per_min ?? null, xpm: m.xp_per_min ?? null, lh: m.last_hits ?? null, dn: m.denies ?? null,
  hd: m.hero_damage ?? null, td: m.tower_damage ?? null, hh: m.hero_healing ?? null, parsed: m.version != null ? 1 : 0,
});

/**
 * Fetch only matches newer than what is stored. First run pulls the full ranked history in one request.
 * Returns { matches, added, total }. Matches are newest-first.
 */
export async function sync(id, { signal } = {}) {
  const local = loadLocal(id);
  const newest = local.matches[0];
  let q = RANKED + '&' + projectQuery();
  if (newest) {
    // `date` is "last N days"; add a day of overlap and dedupe by match id.
    const days = Math.ceil((Date.now() / 1000 - newest.t) / 86400) + 1;
    q += '&date=' + days;
  }
  const rows = await get('players/' + id + '/matches?' + q, { signal });
  const seen = new Set(local.matches.map(m => m.id));
  const fresh = rows.filter(r => !seen.has(r.match_id)).map(slim);
  // A parse can finish after we first stored a match, so refresh the parsed flag on the overlap.
  const parsedNow = new Map(rows.filter(r => r.version != null).map(r => [r.match_id, 1]));
  for (const m of local.matches) if (!m.parsed && parsedNow.has(m.id)) m.parsed = 1;
  const matches = fresh.concat(local.matches).sort((a, b) => b.t - a.t);
  const next = { id, matches, syncedAt: Date.now() };
  if (!store.set('matches:' + id, next)) {
    // Storage full or blocked: keep working in memory for this session.
    console.warn('Astra: could not persist matches locally');
  }
  return { matches, added: fresh.length, total: matches.length };
}

