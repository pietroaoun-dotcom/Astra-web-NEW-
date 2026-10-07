// Profile sync: keeps the player's profile data in step with the server (api/state.js), keyed by player ID.
// The browser copy is used instantly and offline; changes are pushed a moment later; on open, a newer
// server copy (e.g. from another device) replaces the local one.
import { store } from './store.js';

const SYNC_KEYS = ['prefs', 'memory', 'notes', 'draft', 'convo', 'lastReviewed', 'reminders', 'tts', 'voice', 'coachTake'];
const synced = key => SYNC_KEYS.includes(key) || key.startsWith('gamenotes:');

/**
 * opts: getId(): player id or null; passcode(): string; onPulled(): re-render after server data arrives;
 * onStatus(status, detail): 'off' | 'saving' | 'saved' | 'error' | 'nostorage' | 'locked'.
 */
export function createProfileSync({ getId, passcode, onPulled, onStatus }) {
  let timer = null, busy = false, again = false;
  const meta = () => store.get('profileMeta', { updatedAt: 0, syncedAt: 0 });
  const setMeta = m => store.setQuiet('profileMeta', { ...meta(), ...m });
  const status = (s, d = '') => onStatus(s, d);

  function collect() {
    const doc = {};
    for (const k of SYNC_KEYS) { const v = store.get(k); if (v !== null) doc[k] = v; }
    doc.gamenotes = {};
    for (const k of store.keys('gamenotes:')) doc.gamenotes[k.slice('gamenotes:'.length)] = store.get(k);
    return doc;
  }
  function apply(doc) {
    for (const k of SYNC_KEYS) if (k in doc) store.setQuiet(k, doc[k]);
    for (const [id, v] of Object.entries(doc.gamenotes || {})) store.setQuiet('gamenotes:' + id, v);
  }

  async function call(body) {
    const res = await fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-passcode': passcode() }, body: JSON.stringify({ id: getId(), ...body }) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  function fail(r) {
    if (r.status === 401) return status('locked', 'Enter your passcode to save to your profile.');
    if (r.status === 503 && r.data.error === 'storage') return status('nostorage', r.data.message);
    if (r.status === 404) return status('off', 'Profile saving needs Astra\'s server (start-astra.bat or Vercel).');
    return status('error', r.data.message || 'Could not save to your profile.');
  }

  async function push() {
    if (!getId() || !passcode()) return status(passcode() ? 'off' : 'locked', 'Saved on this device only.');
    if (busy) { again = true; return; }
    busy = true; status('saving');
    try {
      const updatedAt = meta().updatedAt || Date.now();
      const r = await call({ op: 'put', doc: collect(), updatedAt });
      if (r.status === 200) { setMeta({ syncedAt: Date.now() }); status('saved'); }
      else if (r.status === 409) { apply(r.data.doc || {}); setMeta({ updatedAt: r.data.updatedAt, syncedAt: Date.now() }); status('saved'); onPulled(); }
      else fail(r);
    } catch { status('error', 'Offline: changes are kept on this device and saved when the server is reachable.'); }
    finally { busy = false; if (again) { again = false; schedule(); } }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(push, 1500); }

  /** On open (and when the passcode is entered): adopt a newer server copy, or upload a newer local one. */
  async function pull() {
    if (!getId()) return status('off');
    if (!passcode()) return status('locked', 'Enter your passcode to save to your profile.');
    try {
      const r = await call({ op: 'get' });
      if (r.status !== 200) return fail(r);
      const local = meta().updatedAt || 0;
      if (r.data.doc && r.data.updatedAt > local) {
        apply(r.data.doc); setMeta({ updatedAt: r.data.updatedAt, syncedAt: Date.now() }); status('saved'); onPulled();
      } else if (local > (r.data.updatedAt || 0) || !r.data.doc) { setMeta({ updatedAt: local || Date.now() }); await push(); }
      else status('saved');
    } catch { status('error', 'Offline: using the copy on this device.'); }
  }

  store.onChange(key => { if (synced(key) && getId()) { setMeta({ updatedAt: Date.now() }); schedule(); } });
  // Save before the tab closes if a change is still waiting.
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); push(); } });

  return { pull, push, collect };
}
