// POST /api/agent { text, context, heroNames, final? }  header: x-astra-passcode  ->  { reply, actions, requests }
// The voice assistant: one call turns what the player said into app actions plus a grounded reply.
// The browser applies the actions (its data lives there) and shows what actually changed. When the AI needs
// numbers that are not in the context it returns data requests; the browser runs them over the full match
// history and calls again with final: true and the results in context.queryResults.
import { complete } from './_llm.js';
import { AGENT_SYSTEM, AGENT_SCHEMA, ACTION_TYPES, PAGES as PAGE_LIST } from './_prompt.js';
import { guard, send, clip, readJson } from './_guard.js';
import { defang, notesBlock } from './_text.js';
import { LIMITS as ASK_LIMITS, sendLlmError } from './ask.js';

export const AGENT_LIMITS = { text: 500, context: 32000, heroNames: 200, perIpPerMin: 15, maxActions: 12, maxRequests: 4 };

const TYPES = new Set(ACTION_TYPES);
const PAGES = new Set(PAGE_LIST);
const FIELDS = new Set(['role', 'goal', 'focus']);

const strings = v => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []).filter(x => typeof x === 'string' && x.trim());

/** Convert the named schema fields (enemy_picks, favorites_add, ...) into the app's action list. */
export function fieldsToActions(o) {
  const out = [];
  const list = (type, v, extra = {}) => { const h = strings(v); if (h.length) out.push({ type, heroes: h, ...extra }); };
  if (o.clear_draft === true) out.push({ type: 'draft_clear' });
  list('draft_add', o.enemy_picks, { team: 'enemy' });
  list('draft_add', o.ally_picks, { team: 'ally' });
  list('draft_mine', o.my_hero);
  list('draft_remove', o.remove_picks);
  if (typeof o.role === 'string' && o.role) out.push({ type: 'pref_set', field: 'role', value: o.role === 'any' ? '' : o.role });
  if (typeof o.goal === 'string' && o.goal.trim()) out.push({ type: 'pref_set', field: 'goal', value: o.goal });
  if (typeof o.focus === 'string' && o.focus) out.push({ type: 'pref_set', field: 'focus', value: o.focus === 'none' ? '' : o.focus });
  list('favorite_add', o.favorites_add); list('favorite_remove', o.favorites_remove);
  list('avoid_add', o.avoid_add); list('avoid_remove', o.avoid_remove);
  strings(o.game_notes).forEach(text => out.push({ type: 'note', text }));
  strings(o.remember).forEach(text => out.push({ type: 'remember', text }));
  strings(o.forget).forEach(text => out.push({ type: 'forget', text }));
  if (o.game === 'start') out.push({ type: 'game_start' });
  if (o.game === 'finish') out.push({ type: 'game_finish' });
  if (typeof o.open_page === 'string' && o.open_page) out.push({ type: 'navigate', page: o.open_page, ...(o.open_hero ? { heroes: strings(o.open_hero) } : {}) });
  return out;
}

/**
 * Small models sometimes fill fields the player never mentioned (measured: role reset to "any" on unrelated
 * sentences). These changes are only kept when what the player said is actually about them.
 */
const GATES = {
  role: /\b(role|carry|mid|middle|support|supp|position|pos ?[1-5]|core|offlane|safelane)\b/i,
  focus: /\b(focus|work on|improve|practi[cs]e|concentrate)\b/i,
  goal: /\b(goal|aim|target|reach|climb|get to)\b/i,
  draft_clear: /\b(clear|reset|new draft|start over|empty)\b/i,
  game_start: /\b(start|started|starting|begin|began|beginning|loading|in game|game on)\b/i,
  game_finish: /\b(finish|finished|game over|ended|done|gg)\b|\b(won|lost) (the|that|this) (game|match)\b/i,
  navigate: /\b(open|show|go|take me|page|view|bring up|switch to)\b/i,
  forget: /\b(forget|delete|remove|erase|drop)\b/i,
};
export function gateActions(actions, said) {
  const s = String(said || '');
  if (!s) return actions;
  return actions.filter(a => {
    const gate = a.type === 'pref_set' ? GATES[a.field] : GATES[a.type];
    return !gate || gate.test(s);
  });
}

/** Keep data requests as small plain objects; the browser validates every field before running them. */
export function sanitizeRequests(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const q of list.slice(0, AGENT_LIMITS.maxRequests)) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) continue;
    const x = {};
    for (const [k, v] of Object.entries(q).slice(0, 30)) {
      if (typeof v === 'string') x[k] = clip(v, 80);
      else if (typeof v === 'number' || typeof v === 'boolean') x[k] = v;
      else if (Array.isArray(v)) x[k] = v.filter(i => typeof i === 'string').slice(0, 7).map(i => clip(i, 40));
    }
    if (Object.keys(x).length) out.push(x);
  }
  return out;
}

/** Parse the model output into { reply, actions, requests }, tolerating stray text around the JSON. */
export function parseAgentOutput(raw, said = '') {
  const s = String(raw || '').trim();
  const tryParse = t => { try { return JSON.parse(t); } catch { return null; } };
  let obj = tryParse(s);
  if (!obj) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a >= 0 && b > a) obj = tryParse(s.slice(a, b + 1)); }
  if (!obj || typeof obj !== 'object') return { reply: s.slice(0, 3000), actions: [], requests: [] };
  // Named fields (current schema); a generic "actions" list is still accepted (e.g. from other providers).
  const actions = Array.isArray(obj.actions) ? obj.actions : fieldsToActions(obj);
  return { reply: clip(obj.reply, 3000).trim(), actions: gateActions(sanitizeActions(actions), said), requests: sanitizeRequests(obj.data_requests) };
}

/** Keep only well-formed actions with known types and bounded fields. */
export function sanitizeActions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, AGENT_LIMITS.maxActions)) {
    if (!a || typeof a !== 'object' || !TYPES.has(a.type)) continue;
    const x = { type: a.type };
    if (a.team === 'ally' || a.team === 'enemy') x.team = a.team;
    if (Array.isArray(a.heroes)) x.heroes = a.heroes.filter(h => typeof h === 'string').slice(0, 10).map(h => clip(h, 40).trim()).filter(Boolean);
    if (FIELDS.has(a.field)) x.field = a.field;
    if (a.value != null) x.value = clip(a.value, 120).trim();
    if (a.text != null) x.text = clip(a.text, 300).trim();
    if (PAGES.has(a.page)) x.page = a.page;
    // Drop actions missing what they need.
    if (/^(draft_add|draft_remove|draft_mine|favorite_|avoid_)/.test(x.type) && !(x.heroes && x.heroes.length)) continue;
    if (x.type === 'draft_add' && !x.team) continue;
    if ((x.type === 'note' || x.type === 'remember' || x.type === 'forget') && !x.text) continue;
    if (x.type === 'pref_set' && (!x.field || x.value == null)) continue;
    if (x.type === 'navigate' && !x.page) continue;
    out.push(x);
  }
  return out;
}

export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'ask', perMin: AGENT_LIMITS.perIpPerMin, daily: ASK_LIMITS.dailyTotal });
  if (!g) return;
  let body;
  try { body = await readJson(req, AGENT_LIMITS.context + 12000); } catch (e) { return send(res, e.status || 400, { error: 'body', message: e.status === 413 ? 'Request too large.' : 'Invalid JSON.' }); }

  const text = clip(body.text, AGENT_LIMITS.text).trim();
  if (!text) return send(res, 400, { error: 'input', message: 'Say something first.' });
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const heroNames = (Array.isArray(body.heroNames) ? body.heroNames : []).filter(h => typeof h === 'string').slice(0, AGENT_LIMITS.heroNames).map(h => clip(h, 40));
  const ctxText = JSON.stringify({ ...ctx, notes: undefined });
  if (ctxText.length > AGENT_LIMITS.context) return send(res, 413, { error: 'input', message: 'Context too large.' });

  const final = body.final === true;
  const data = JSON.stringify({ ...ctx, notes: undefined, heroNames, ...(final ? { final: true } : {}) });
  const user = `<data>\n${defang(data)}\n</data>\n<notes>\n${notesBlock(ctx.notes)}\n</notes>\n<said>\n${defang(text)}\n</said>`;
  g.take();
  try {
    const raw = await complete({ system: AGENT_SYSTEM, user, maxTokens: 6000, schema: AGENT_SCHEMA, smart: true });
    const out = parseAgentOutput(raw, text);
    if (final) out.requests = [];
    return send(res, 200, out);
  } catch (e) {
    g.refund();
    return sendLlmError(res, e);
  }
}
