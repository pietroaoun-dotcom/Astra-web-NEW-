// Local persistence (offline cache). Server-side sync arrives in milestone 7.
const NS = 'astra:';

export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(NS + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem(NS + key); } catch { /* ignore */ } },
};

export const DEFAULT_PREFS = { favorites: [], avoided: [], role: '', goal: '', focus: '' };

export const loadPrefs = () => ({ ...DEFAULT_PREFS, ...store.get('prefs', {}) });
export const savePrefs = p => store.set('prefs', p);

/** Cached JSON with a time-to-live (used for heroStats and benchmarks). */
export function cached(key, ttlMs) {
  const e = store.get('cache:' + key);
  return e && Date.now() - e.t < ttlMs ? e.v : null;
}
export const putCache = (key, v) => store.set('cache:' + key, { t: Date.now(), v });
