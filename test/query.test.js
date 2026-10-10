import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQuery, runQueries, autoQueries, normalizeQuery, statsOf } from '../js/query.js';
import { teamsOf, slim } from '../js/sync.js';
import { parseAgentOutput, sanitizeRequests } from '../api/agent.js';
import { geminiModels } from '../api/_llm.js';

const heroes = {
  1: { id: 1, name: 'Anti-Mage', roles: ['Carry'] }, 2: { id: 2, name: 'Axe', roles: ['Initiator'] },
  25: { id: 25, name: 'Lina', roles: ['Support', 'Carry'] }, 5: { id: 5, name: 'Crystal Maiden', roles: ['Support'] },
  14: { id: 14, name: 'Pudge', roles: ['Disabler'] }, 74: { id: 74, name: 'Invoker', roles: ['Carry'] },
};
const NOW = new Date('2026-10-10T12:00:00');
const T = NOW.getTime() / 1000;
// Radiant player (slot 0); s >= 128 would be Dire. rw: 1 = radiant won.
const g = (i, h, win, extra = {}) => ({ id: i, t: T - i * 3600 * 5, d: 2400, h, s: 0, rw: win ? 1 : 0, k: 5, de: 4, a: 10, p: 1, gpm: 500, xpm: 600, lh: 200, ...extra });

const matches = [
  g(1, 74, true, { al: [5, 25, 1, 14], en: [2, 41, 42, 43, 44] }),
  g(2, 74, false, { al: [5, 25, 1, 14], en: [2, 41, 42, 43, 44] }),
  g(3, 74, false, { al: [5], en: [2] }),
  g(4, 14, true, { al: [25], en: [1] }),
  g(5, 14, true),                       // older sync: no team data
  g(400, 74, true, { d: 1500 }),        // ~83 days ago, short game
];

test('filters by hero played and reports a baseline', () => {
  const r = runQuery(matches, heroes, { hero: ['invoker'] }, NOW);
  assert.equal(r.result.games, 4);
  assert.equal(r.result.record, '2-2');
  assert.equal(r.baseline.games, 6);
  assert.match(r.query, /playing Invoker/);
});

test('against and with use team data and say how many games lack it', () => {
  const vs = runQuery(matches, heroes, { against: ['Axe'] }, NOW);
  assert.equal(vs.result.games, 3);
  assert.equal(vs.result.record, '1-2');
  assert.ok(vs.notes.some(n => /no team data/.test(n)));
  const w = runQuery(matches, heroes, { with: ['cm', 'Lina'] }, NOW);
  assert.equal(w.result.games, 2);
});

test('groups by enemy with a minimum and sorts by win rate', () => {
  const r = runQuery(matches, heroes, { groupBy: 'enemy', sortBy: 'winRate', order: 'asc', minGames: 2 }, NOW);
  assert.equal(r.groups.rows[0].group, 'Axe');
  assert.equal(r.groups.rows[0].games, 3);
});

test('time filters: lastDays, period and game length', () => {
  assert.equal(runQuery(matches, heroes, { lastDays: 30 }, NOW).result.games, 5);
  assert.equal(runQuery(matches, heroes, { maxMinutes: 30 }, NOW).result.games, 1);
  assert.equal(runQuery(matches, heroes, { period: 'today' }, NOW).result.games, 2);
});

test('listGames returns individual games with teams', () => {
  const r = runQuery(matches, heroes, { hero: ['Invoker'], result: 'loss', listGames: true }, NOW);
  assert.equal(r.gamesList.length, 2);
  assert.deepEqual(r.gamesList[1].enemies, ['Axe']);
});

test('normalizeQuery drops unknown keys and clamps values', () => {
  const q = normalizeQuery({ hero: 'Pudge', limit: 999, groupBy: 'bogus', evil: 'x', from: 'not a date', weekday: ['Saturday', 'xyz'] });
  assert.deepEqual(q, { hero: ['Pudge'], limit: 25, weekday: ['sat'] });
});

test('unknown hero names are reported, not silently matched', () => {
  const r = runQuery(matches, heroes, { hero: ['Notahero'] }, NOW);
  assert.ok(r.notes[0].includes('Notahero'));
});

test('runQueries never throws and caps the count', () => {
  const r = runQueries(matches, heroes, [null, {}, {}, {}, {}, {}], NOW);
  assert.equal(r.length, 4);
  assert.ok(r[0].error);
});

test('autoQueries covers heroes and periods named in the question', () => {
  const q = autoQueries('how do I do against axe this week?', heroes);
  assert.ok(q.some(x => x.against && x.against[0] === 'Axe' && x.period === 'this_week'));
  assert.ok(q.some(x => x.hero && x.hero[0] === 'Axe'));
  const combo = autoQueries('how is my Invoker vs Axe and Lina?', heroes)[0];
  assert.deepEqual([combo.hero, combo.against], [['Invoker'], ['Axe', 'Lina']]);
  assert.deepEqual(autoQueries('pudge with cm', heroes)[0].with, ['Crystal Maiden']);
  const p = autoQueries('summarise my last 50 games', heroes);
  assert.equal(p[0].lastGames, 50);
});

test('statsOf flags small samples', () => {
  assert.match(statsOf(matches.slice(0, 3)).sample, /small/);
  assert.deepEqual(statsOf([]), { games: 0 });
});

test('teamsOf splits the ten picks into allies and enemies without the player', () => {
  const heroesField = {};
  [0, 1, 2, 3, 4].forEach((slot, i) => { heroesField[slot] = { hero_id: 10 + i, player_slot: slot }; });
  [128, 129, 130, 131, 132].forEach((slot, i) => { heroesField[slot] = { hero_id: 20 + i, player_slot: slot }; });
  assert.deepEqual(teamsOf({ player_slot: 129, heroes: heroesField }), { al: [20, 22, 23, 24], en: [10, 11, 12, 13, 14] });
  assert.deepEqual(teamsOf({ player_slot: 0 }), {});
  assert.deepEqual(slim({ match_id: 1, player_slot: 0, heroes: heroesField }).al, [11, 12, 13, 14]);
});

test('agent output carries sanitized data requests', () => {
  const raw = JSON.stringify({ reply: '', data_requests: [{ label: 'x', against: ['Axe', 5], groupBy: 'enemy', nested: { a: 1 } }, 'junk'] });
  const out = parseAgentOutput(raw, 'who do I lose to');
  assert.deepEqual(out.requests, [{ label: 'x', against: ['Axe'], groupBy: 'enemy' }]);
  assert.equal(sanitizeRequests(new Array(10).fill({ hero: ['Lina'] })).length, 4);
});

test('coaching answers try the full model before the lite fallbacks', () => {
  const prev = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  const smart = geminiModels({ smart: true });
  assert.equal(smart[0], 'gemini-3.5-flash');
  assert.ok(smart.includes('gemini-3.1-flash-lite'));
  assert.equal(geminiModels()[0], 'gemini-3.5-flash-lite');
  if (prev === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = prev;
});
