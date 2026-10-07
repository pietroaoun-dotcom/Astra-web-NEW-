// Local persistence. Profile data (preferences, memory, notes, draft, conversation, settings) is kept per
// player ID, so switching players never mixes data, and is synced to the server by js/profile.js.
const NS = 'astra:';

/** Keys that belong to a player profile (stored as p:<id>:<key>). Everything else is device-wide. */
const SCOPED = new Set(['prefs', 'memory', 'notes', 'draft', 'convo', 'lastReviewed', 'reminders', 'tts', 'voice',
  'gameStart', 'firedReminders', 'profileMeta', 'coachTake']);
const isScoped = key => SCOPED.has(key) || key.startsWith('gamenotes:');

let profile = null;
const listeners = new Set();
const full = key => NS + (profile && isScoped(key) ? `p:${profile}:${key}` : key);
const notify = key => listeners.forEach(f => { try { f(key); } catch (e) { console.error(e); } });

function rawSet(key, value) {
  try { localStorage.setItem(full(key), JSON.stringify(value)); return true; } catch { return false; }
}

export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(full(key)); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { const ok = rawSet(key, value); notify(key); return ok; },
  /** Write without notifying listeners (used when applying data pulled from the server). */
  setQuiet(key, value) { return rawSet(key, value); },
  del(key) { try { localStorage.removeItem(full(key)); } catch { /* ignore */ } notify(key); },
  /** Keys of the current profile (or device) that start with a prefix, without the namespace. */
  keys(prefix) {
    const base = NS + (profile && isScoped(prefix) ? `p:${profile}:` : '');
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(base + prefix)) out.push(k.slice(base.length));
      }
    } catch { /* storage blocked */ }
    return out;
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Switch the active profile. Data saved before profiles existed is moved into the first profile once. */
  setProfile(id) {
    profile = id ? String(id) : null;
    if (!profile) return;
    try {
      const legacy = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(NS) || k.startsWith(NS + 'p:')) continue;
        const key = k.slice(NS.length);
        if (isScoped(key)) legacy.push(key);
      }
      for (const key of legacy) {
        const scoped = `${NS}p:${profile}:${key}`;
        if (localStorage.getItem(scoped) == null) localStorage.setItem(scoped, localStorage.getItem(NS + key));
        localStorage.removeItem(NS + key);
      }
    } catch { /* storage blocked */ }
  },
  get profile() { return profile; },
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
