// LLM provider adapter. Default is Gemini's free tier; set LLM_PROVIDER=anthropic to swap.
// Env: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_SMART_MODEL, GEMINI_REVIEW_MODEL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL.

export class LlmError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

// Per-attempt timeouts. Text calls fall through a model list inside one overall budget, and voice calls through
// up to 3 models (3 x 15 s), so both stay inside the 60 s maxDuration set in vercel.json.
export const TEXT_TIMEOUT_MS = 18000, VOICE_TIMEOUT_MS = 15000;
export const SMART_TIMEOUT_MS = 30000, TEXT_BUDGET_MS = 54000;

/**
 * Text models to try, best first. Coaching answers (smart) start with the full Flash model, which reasons far
 * better than the lite models, and fall back to the lite models when it is busy, missing or slow.
 */
export function geminiModels({ smart = false, review = false } = {}) {
  const env = process.env;
  const first = smart ? [review && env.GEMINI_REVIEW_MODEL, env.GEMINI_SMART_MODEL, 'gemini-3.5-flash', env.GEMINI_MODEL] : [review && env.GEMINI_REVIEW_MODEL, env.GEMINI_MODEL];
  return [...new Set([...first, 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].filter(Boolean))];
}

async function post(url, headers, body, timeoutMs = TEXT_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (res.status === 503) throw new LlmError('busy', 'The AI provider is under high demand. Try again in a moment.');
    if (res.status === 429) throw new LlmError('busy', 'The AI provider is rate limited right now.');
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'The AI provider rejected the API key.');
    if (!res.ok) throw new LlmError('upstream', 'The AI provider returned HTTP ' + res.status + '.');
    return await res.json();
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError('upstream', e.name === 'AbortError' ? 'The AI provider timed out.' : 'Could not reach the AI provider.');
  } finally { clearTimeout(timer); }
}

async function gemini({ system, user, review, smart, maxTokens, schema }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LlmError('config', 'GEMINI_API_KEY is not set.');
  // The full flash models are sometimes overloaded on the free tier, so fall through the list when one is busy,
  // unavailable or too slow for the remaining time budget.
  const models = geminiModels({ smart, review });
  const t0 = Date.now();
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    // Newer Gemini models may spend part of maxOutputTokens on internal thinking, so the cap is generous;
    // answer length is controlled by the system prompt (under about 170 words).
    generationConfig: { maxOutputTokens: maxTokens, temperature: schema ? 0.2 : 0.4, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
  };
  let data, last;
  for (const [i, model] of models.entries()) {
    const left = TEXT_BUDGET_MS - (Date.now() - t0);
    if (left < 5000) break;
    // The first (strongest) model gets more time to think; the fallbacks share what is left.
    const limit = Math.min(left, i === 0 && smart ? SMART_TIMEOUT_MS : TEXT_TIMEOUT_MS);
    try {
      data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body, limit);
      break;
    } catch (e) {
      last = e;
      if (!(e instanceof LlmError) || (e.kind !== 'busy' && e.kind !== 'upstream')) throw e;
    }
  }
  if (!data) throw last || new LlmError('busy', 'The AI took too long. Try again.');
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
  if (!text) throw new LlmError('empty', 'The AI returned no answer' + (cand && cand.finishReason ? ' (' + cand.finishReason + ').' : '.'));
  return text;
}

async function anthropic({ system, user, maxTokens, schema }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new LlmError('config', 'ANTHROPIC_API_KEY is not set.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const sys = schema ? system + '\n\nRespond with ONLY a JSON object matching this schema, no prose around it:\n' + JSON.stringify(schema) : system;
  const data = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: user }] }, SMART_TIMEOUT_MS);
  const text = (data.content || []).map(b => b.text || '').join('').trim();
  if (!text) throw new LlmError('empty', 'The AI returned no answer.');
  return text;
}

/** Wrap raw 16-bit mono PCM in a WAV header so any browser can play it. */
export function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Text to speech via Gemini TTS. Returns a WAV Buffer. Falls through the model list when one is busy. */
export async function speech({ text, voice }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LlmError('config', 'GEMINI_API_KEY is not set.');
  const models = [...new Set([process.env.GEMINI_TTS_MODEL, 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'].filter(Boolean))];
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };
  let last;
  for (const model of models) {
    try {
      const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body, VOICE_TIMEOUT_MS);
      const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
      if (!part || !part.data) throw new LlmError('empty', 'The voice service returned no audio.');
      const buf = Buffer.from(part.data, 'base64');
      if (/wav/i.test(part.mimeType) || buf.subarray(0, 4).toString() === 'RIFF') return buf;
      const rate = Number((/rate=(\d+)/.exec(part.mimeType) || [])[1]) || 24000;
      return pcmToWav(buf, rate);
    } catch (e) {
      last = e;
      if (!(e instanceof LlmError) || !['busy', 'upstream', 'empty'].includes(e.kind)) throw e;
    }
  }
  throw last;
}

export function complete(opts) {
  return (process.env.LLM_PROVIDER === 'anthropic' ? anthropic : gemini)(opts);
}
