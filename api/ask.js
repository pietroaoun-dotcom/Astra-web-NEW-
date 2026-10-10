// POST /api/ask  { question, context, kind?: 'quick' | 'review' }  header: x-astra-passcode
// Plain question answering and post-game reviews. Voice commands go through /api/agent.
// Works as a Vercel function and under scripts/serve.js (plain Node req/res, no framework helpers).
import { complete, LlmError } from './_llm.js';
import { SYSTEM } from './_prompt.js';
import { guard, send, clip, readJson, _resetGuard } from './_guard.js';
import { defang, notesBlock } from './_text.js';

export const LIMITS = {
  question: 500, context: 32000,
  perIpPerMin: 8, badPasscodePerMin: 5, dailyTotal: Number(process.env.ASTRA_DAILY_LIMIT) || 400,
  outTokens: { quick: 4000, review: 5000 }, // includes the model's internal thinking tokens
};
export const _resetLimits = _resetGuard;

/** Map provider errors to HTTP responses (shared with /api/agent). */
export function sendLlmError(res, e) {
  if (e instanceof LlmError) {
    const status = e.kind === 'busy' ? 429 : e.kind === 'config' ? 503 : 502;
    return send(res, status, { error: e.kind, message: e.message });
  }
  return send(res, 500, { error: 'server', message: 'Unexpected server error.' });
}

export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'ask', perMin: LIMITS.perIpPerMin, daily: LIMITS.dailyTotal });
  if (!g) return;

  let body;
  try { body = await readJson(req, LIMITS.context + 4000); } catch (e) { return send(res, e.status || 400, { error: 'body', message: e.status === 413 ? 'Request too large.' : 'Invalid JSON.' }); }

  const question = clip(body.question, LIMITS.question).trim();
  if (!question) return send(res, 400, { error: 'input', message: 'Ask a question first.' });
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const ctxText = JSON.stringify({ ...ctx, notes: undefined });
  if (ctxText.length > LIMITS.context) return send(res, 413, { error: 'input', message: 'Context too large.' });
  const review = body.kind === 'review';

  const user = `<data>\n${defang(ctxText)}\n</data>\n<notes>\n${notesBlock(ctx.notes)}\n</notes>\n<question>\n${defang(question)}\n</question>`;
  g.take();
  try {
    const answer = await complete({ system: SYSTEM, user, review, smart: true, maxTokens: LIMITS.outTokens[review ? 'review' : 'quick'] });
    return send(res, 200, { answer: answer.slice(0, 3000) });
  } catch (e) {
    g.refund();
    return sendLlmError(res, e);
  }
}
