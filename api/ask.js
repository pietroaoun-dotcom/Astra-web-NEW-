// POST /api/ask  { question, context, kind?: 'quick' | 'review' }  header: x-astra-passcode
// Works as a Vercel function and under scripts/serve.js (plain Node req/res, no framework helpers).
import { complete, LlmError } from './_llm.js';
import { SYSTEM } from './_prompt.js';
import { guard, send, clip, readJson, _resetGuard } from './_guard.js';

export const LIMITS = {
  question: 500, context: 14000, notes: 20, noteLen: 300,
  perIpPerMin: 8, badPasscodePerMin: 5, dailyTotal: Number(process.env.ASTRA_DAILY_LIMIT) || 150,
  outTokens: { quick: 1500, review: 2000 }, // includes the model's internal thinking tokens
};
export const _resetLimits = _resetGuard;

// Stop player text from closing our data tags.
const defang = s => s.replace(/<\/?(data|notes|question)[^>]*>/gi, '');

export default async function handler(req, res) {
  const g = guard(req, res, { name: 'ask', perMin: LIMITS.perIpPerMin, daily: LIMITS.dailyTotal });
  if (!g) return;

  let body;
  try { body = await readJson(req, LIMITS.context + 4000); } catch (e) { return send(res, e.status || 400, { error: 'body', message: e.status === 413 ? 'Request too large.' : 'Invalid JSON.' }); }

  const question = clip(body.question, LIMITS.question).trim();
  if (!question) return send(res, 400, { error: 'input', message: 'Ask a question first.' });
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const ctxText = JSON.stringify({ ...ctx, notes: undefined });
  if (ctxText.length > LIMITS.context) return send(res, 413, { error: 'input', message: 'Context too large.' });
  const notes = (Array.isArray(ctx.notes) ? ctx.notes : []).slice(-LIMITS.notes).map(n => clip(typeof n === 'string' ? n : n && n.text, LIMITS.noteLen)).filter(Boolean);
  const review = body.kind === 'review';

  const user = `<data>\n${defang(ctxText)}\n</data>\n<notes>\n${notes.map(n => '- ' + defang(n)).join('\n') || '(none)'}\n</notes>\n<question>\n${defang(question)}\n</question>`;
  g.take();
  try {
    const answer = await complete({ system: SYSTEM, user, review, maxTokens: LIMITS.outTokens[review ? 'review' : 'quick'] });
    return send(res, 200, { answer: answer.slice(0, 2500) });
  } catch (e) {
    g.refund();
    if (e instanceof LlmError) {
      const status = e.kind === 'busy' ? 429 : e.kind === 'config' ? 503 : 502;
      return send(res, status, { error: e.kind, message: e.message });
    }
    return send(res, 500, { error: 'server', message: 'Unexpected server error.' });
  }
}
