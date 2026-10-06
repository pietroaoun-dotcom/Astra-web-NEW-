// OpenDota client: ID parsing, rate-limited fetch with 429 backoff, typed errors.
const OD = 'https://api.opendota.com/api/';
const STEAM64 = 76561197960265728n;

export class ApiError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/** Accepts a 32-bit account ID, a 64-bit Steam ID, or an OpenDota/Dotabuff/Steam profile URL. */
export function parseId(input) {
  const s = String(input ?? '').trim();
  if (!s) return { error: 'Enter your player ID or a profile link.' };
  if (/steamcommunity\.com\/id\//i.test(s)) {
    return { error: 'Custom Steam URLs (/id/name) can\'t be resolved. Use your numeric ID from opendota.com or dotabuff.com.' };
  }
  const m = s.match(/(?:players?|profiles?)\/(\d{3,20})/i) || s.match(/^(\d{3,20})$/);
  if (!m) return { error: 'That doesn\'t look like an ID. Use digits only, or paste an OpenDota, Dotabuff or Steam profile link.' };
  let n = BigInt(m[1]);
  if (n >= STEAM64) n -= STEAM64;
  if (n <= 0n || n > 4294967295n) return { error: 'That ID is outside the valid range.' };
  return { id: Number(n) };
}

// 60 requests/min on the free tier: keep a sliding window below it, and limit concurrency.
const WINDOW_MS = 60000, MAX_PER_WINDOW = 50, MAX_CONCURRENT = 4;
const stamps = [];
let inflight = 0;
const waiters = [];
export const usage = { requests: 0, retries: 0 };

async function slot() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift();
    if (inflight < MAX_CONCURRENT && stamps.length < MAX_PER_WINDOW) {
      inflight++; stamps.push(now); return;
    }
    const wait = stamps.length >= MAX_PER_WINDOW ? WINDOW_MS - (now - stamps[0]) + 25 : 50;
    await new Promise(r => setTimeout(r, wait));
  }
}

export async function get(path, { signal, method = 'GET', retries = 3 } = {}) {
  let delay = 1500;
  for (let attempt = 0; ; attempt++) {
    await slot();
    let res;
    try {
      usage.requests++;
      res = await fetch(OD + path, { signal, method });
    } catch (e) {
      inflight--;
      if (e.name === 'AbortError') throw e;
      if (attempt >= retries) throw new ApiError('network', 'Could not reach OpenDota. Check your connection and try again.');
      await new Promise(r => setTimeout(r, delay)); delay *= 2; continue;
    }
    inflight--;
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) {
        throw new ApiError(res.status === 429 ? 'rate' : 'network',
          res.status === 429 ? 'OpenDota\'s rate limit was hit. Wait a minute and try again.' : 'OpenDota is having problems (HTTP ' + res.status + '). Try again shortly.');
      }
      usage.retries++;
      const ra = Number(res.headers.get('retry-after'));
      await new Promise(r => setTimeout(r, ra ? ra * 1000 : delay)); delay *= 2; continue;
    }
    if (res.status === 404) throw new ApiError('notfound', 'Not found on OpenDota.');
    if (!res.ok) throw new ApiError('network', 'OpenDota returned HTTP ' + res.status + '.');
    return res.json();
  }
}

/** Fields we store per match. Everything here is available unparsed. */
export const MATCH_FIELDS = ['hero_id', 'start_time', 'duration', 'player_slot', 'radiant_win', 'kills', 'deaths', 'assists',
  'lobby_type', 'game_mode', 'party_size', 'average_rank', 'version', 'gold_per_min', 'xp_per_min', 'last_hits', 'denies',
  'hero_damage', 'tower_damage', 'hero_healing'];

export const projectQuery = () => MATCH_FIELDS.map(f => 'project=' + f).join('&');

export const heroImg = h => h && h.img ? 'https://cdn.cloudflare.steamstatic.com' + h.img.replace(/\?$/, '') : '';
export const heroIcon = h => h && h.icon ? 'https://cdn.cloudflare.steamstatic.com' + h.icon.replace(/\?$/, '') : '';
