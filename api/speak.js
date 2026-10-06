// POST /api/speak { text }  header: x-astra-passcode  ->  audio/wav
// Natural speech from Gemini TTS using a prebuilt voice (no cloning of real people). Same guard as /api/ask.
import { guard, send, clip, readJson } from './_guard.js';
import { speech, LlmError } from './_llm.js';

export const SPEAK_LIMITS = { text: 400, perIpPerMin: 12, dailyTotal: Number(process.env.ASTRA_TTS_DAILY_LIMIT) || 120 };

// The voice is set with ASTRA_VOICE (default Umbriel, easy-going). Do not prefix style instructions to the text:
// the TTS models read them aloud (measured: a style prefix made the same sentence 50 to 150 percent longer).

export default async function handler(req, res) {
  const g = guard(req, res, { name: 'speak', perMin: SPEAK_LIMITS.perIpPerMin, daily: SPEAK_LIMITS.dailyTotal });
  if (!g) return;
  let body;
  try { body = await readJson(req, 4000); } catch (e) { return send(res, e.status || 400, { error: 'body', message: 'Invalid JSON.' }); }
  const text = clip(body.text, SPEAK_LIMITS.text).replace(/[<>]/g, '').trim();
  if (!text) return send(res, 400, { error: 'input', message: 'Nothing to say.' });
  g.take();
  try {
    const wav = await speech({ text, voice: process.env.ASTRA_VOICE || 'Umbriel' });
    res.statusCode = 200;
    res.setHeader('content-type', 'audio/wav');
    res.setHeader('cache-control', 'no-store');
    res.end(wav);
  } catch (e) {
    g.refund();
    if (e instanceof LlmError) return send(res, e.kind === 'busy' ? 429 : e.kind === 'config' ? 503 : 502, { error: e.kind, message: e.message });
    return send(res, 500, { error: 'server', message: 'Unexpected server error.' });
  }
}
