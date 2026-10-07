// Key-value storage for player profiles.
// On Vercel: Upstash Redis through its REST API (env vars added by the Vercel Storage integration).
// Locally (start-astra.bat): JSON files in data/ (git-ignored, never served by the local server).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class StoreError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const restUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const restToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const dataDir = join(fileURLToPath(import.meta.url), '..', '..', 'data');

/** Where profiles are stored: 'redis', 'file', or null when storage is not set up (Vercel without Upstash). */
export function backend() {
  if (restUrl() && restToken()) return 'redis';
  if (!process.env.VERCEL) return 'file';
  return null;
}

async function redis(command) {
  let res;
  try {
    res = await fetch(restUrl(), { method: 'POST', headers: { authorization: `Bearer ${restToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(command) });
  } catch { throw new StoreError('upstream', 'Could not reach the profile database.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new StoreError('upstream', 'The profile database returned an error' + (data.error ? ': ' + String(data.error).slice(0, 120) : '.'));
  return data.result;
}

const fileFor = key => join(dataDir, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');

export async function kvGet(key) {
  const b = backend();
  if (b === 'redis') { const v = await redis(['GET', key]); return v == null ? null : JSON.parse(v); }
  if (b === 'file') { try { return JSON.parse(await readFile(fileFor(key), 'utf8')); } catch { return null; } }
  throw new StoreError('config', 'Profile storage is not set up yet. In Vercel: Storage > Create Database > Upstash for Redis, connect it to this project, then redeploy.');
}

export async function kvSet(key, value) {
  const b = backend();
  const text = JSON.stringify(value);
  if (b === 'redis') { await redis(['SET', key, text]); return; }
  if (b === 'file') { await mkdir(dataDir, { recursive: true }); await writeFile(fileFor(key), text); return; }
  throw new StoreError('config', 'Profile storage is not set up yet. In Vercel: Storage > Create Database > Upstash for Redis, connect it to this project, then redeploy.');
}
