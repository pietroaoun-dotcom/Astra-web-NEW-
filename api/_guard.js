// Shared request guard for the API functions: passcode, failed-attempt lockout, per-IP and daily limits.
import { timingSafeEqual, createHash } from 'node:crypto';

// Best-effort counters held in memory. On serverless these reset when an instance recycles, so the
// provider's own quota stays the hard ceiling. (Redis-backed counters arrive with persistence.)
const hits = new Map();
const days = new Map(); // name -> { day, count }
export const _resetGuard = () => { hits.clear(); days.clear(); };

export const BAD_PASSCODE_PER_MIN = 5;

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').slice(0, n);

const digest = s => createHash('sha256').update(String(s)).digest();
const passcodeOk = given => {
  const want = process.env.ASTRA_PASSCODE;
  return !!want && !!given && timingSafeEqual(digest(given), digest(want));
};

function limited(key, max, windowMs = 60000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return false;
}

/**
 * Returns { ip, takeDaily() } when the request may proceed, or null after sending an error.
 * name: counter namespace ('ask', 'speak'); perMin: per-IP limit; daily: total per UTC day.
 */
export function guard(req, res, { name, perMin, daily }) {
  if (req.method !== 'POST') { send(res, 405, { error: 'method', message: 'Use POST.' }); return null; }
  const ip = clip((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim(), 60);

  if (!process.env.ASTRA_PASSCODE) { send(res, 503, { error: 'config', message: 'The server has no passcode configured (ASTRA_PASSCODE).' }); return null; }
  // Count only failures, and lock the IP out once there are too many, even if the next guess is right.
  const fails = (hits.get('bad:' + ip) || []).filter(t => Date.now() - t < 60000);
  if (fails.length >= BAD_PASSCODE_PER_MIN) { send(res, 429, { error: 'rate', message: 'Too many wrong passcodes. Wait a minute.' }); return null; }
  if (!passcodeOk(req.headers['x-astra-passcode'])) {
    fails.push(Date.now()); hits.set('bad:' + ip, fails);
    send(res, 401, { error: 'passcode', message: 'Wrong or missing passcode.' }); return null;
  }
  if (limited(name + ':' + ip, perMin)) { send(res, 429, { error: 'rate', message: 'Slow down: too many requests this minute.' }); return null; }

  const today = new Date().toISOString().slice(0, 10);
  let d = days.get(name);
  if (!d || d.day !== today) { d = { day: today, count: 0 }; days.set(name, d); }
  if (d.count >= daily) { send(res, 429, { error: 'daily', message: 'Daily limit reached. It resets tomorrow (UTC).' }); return null; }
  return { ip, take: () => { d.count++; }, refund: () => { d.count = Math.max(0, d.count - 1); } };
}

export async function readJson(req, maxBytes) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
