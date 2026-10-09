// POST /api/state  { op: 'get', id }  or  { op: 'put', id, doc, updatedAt }   header: x-astra-passcode
// Saves the player's profile (preferences, memory, notes, draft, conversation, settings) under their player ID,
// so it follows them across devices and browsers. Last writer wins by updatedAt; an older write gets the
// newer stored copy back (409) so the browser can adopt it.
import { guard, send, readJson } from './_guard.js';
import { kvGet, kvSet, backend, StoreError } from './_store.js';

export const STATE_LIMITS = { bytes: 300000, perIpPerMin: 40, daily: 5000 };
const keyFor = id => 'astra:profile:' + id;

export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'state', perMin: STATE_LIMITS.perIpPerMin, daily: STATE_LIMITS.daily });
  if (!g) return;
  let body;
  try { body = await readJson(req, STATE_LIMITS.bytes + 2000); } catch (e) { return send(res, e.status || 400, { error: 'body', message: e.status === 413 ? 'Profile too large.' : 'Invalid JSON.' }); }
  const id = String(body.id ?? '');
  if (!/^\d{1,10}$/.test(id)) return send(res, 400, { error: 'input', message: 'Invalid player ID.' });

  try {
    const stored = await kvGet(keyFor(id));
    if (body.op === 'get') return send(res, 200, { doc: stored ? stored.doc : null, updatedAt: stored ? stored.updatedAt : 0, backend: backend() });
    if (body.op !== 'put') return send(res, 400, { error: 'input', message: 'Unknown operation.' });
    const doc = body.doc;
    const updatedAt = Number(body.updatedAt) || Date.now();
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return send(res, 400, { error: 'input', message: 'Missing profile data.' });
    if (JSON.stringify(doc).length > STATE_LIMITS.bytes) return send(res, 413, { error: 'input', message: 'Profile too large.' });
    if (stored && stored.updatedAt > updatedAt) return send(res, 409, { error: 'stale', message: 'A newer copy is saved.', doc: stored.doc, updatedAt: stored.updatedAt });
    g.take();
    await kvSet(keyFor(id), { doc, updatedAt, savedAt: Date.now() });
    return send(res, 200, { ok: true, updatedAt, backend: backend() });
  } catch (e) {
    if (e instanceof StoreError) return send(res, e.kind === 'config' ? 503 : 502, { error: e.kind === 'config' ? 'storage' : 'upstream', message: e.message });
    return send(res, 500, { error: 'server', message: 'Unexpected server error.' });
  }
}
