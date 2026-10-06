// Pure helpers for the AI layer: compact context, voice command parsing, rule-based fallback answers.
import { won, avg, winrate, dpm } from './analysis.js';

const r1 = x => Math.round(x * 10) / 10;
const pct = x => Math.round(x * 100);

/** What happened in the newest game, next to the player's norm. Null if there is nothing to compare. */
export function buildLastGame(matches, heroes) {
  const m = matches[0];
  if (!m || matches.length < 10) return null;
  const rest = matches.slice(1, 51).filter(x => x.d > 600);
  const same = matches.slice(1).filter(x => x.h === m.h);
  const h = heroes[m.h];
  return {
    hero: h ? h.name : 'Hero ' + m.h, result: won(m) ? 'win' : 'loss', minutes: r1(m.d / 60),
    kills: m.k, deaths: m.de, assists: m.a, gpm: m.gpm, xpm: m.xpm, lastHits: m.lh,
    deathsPerMin: r1(dpm(m) * 100) / 100, avgDeathsPerMin: r1(avg(rest, dpm) * 100) / 100,
    avgGpmRecent50: Math.round(avg(rest.filter(x => x.gpm != null), x => x.gpm)),
    gamesOnThisHeroBefore: same.length, winRateOnThisHero: same.length ? pct(winrate(same)) + '%' : 'no earlier games',
    avgGpmOnThisHero: same.length ? Math.round(avg(same.filter(x => x.gpm != null), x => x.gpm)) : null,
    parsed: !!m.parsed,
  };
}

/** Compact, number-only context sent to the server. Hero names are resolved here, never raw ids. */
export function buildContext({ account, matches, insights, heroes, rows, prefs, bracketLabel, notes = [], lastGame = null, draft = null, live = null, facts = [], page = null }) {
  const total = matches.length, w = matches.filter(won).length, l10 = matches.slice(0, 10);
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  return {
    player: {
      rank: account ? account.rankName : null, rankedGamesSynced: total, rankedWinRate: total ? pct(w / total) + '%' : null,
      last10: l10.filter(won).length + '-' + (l10.length - l10.filter(won).length), bracketForMeta: bracketLabel,
    },
    planBasis: 'last ' + Math.min(300, total) + ' ranked games',
    plan: insights.slice(0, 8).map(i => ({
      title: i.title, type: i.kind, confidence: i.conf, games: i.n, evidence: i.evidence.slice(0, 3), drill: i.drill || undefined, target: i.target || undefined,
    })),
    heroes: [...rows].sort((a, b) => b.g - a.g).slice(0, 12).map(r => ({
      hero: name(r.id), games: r.g, winRate: pct(r.wr) + '%', bracketWinRate: pct(r.meta) + '%', adjustedWinRate: pct(r.adj) + '%',
      kda: r1(r.k) + '/' + r1(r.de) + '/' + r1(r.a), gpm: Math.round(r.gpm), deathsPerMin: Math.round(r.dpm * 100) / 100,
    })),
    preferences: {
      favoriteHeroes: prefs.favorites.map(name), avoidedHeroes: prefs.avoided.map(name),
      role: prefs.role || null, goal: prefs.goal || null, focus: prefs.focus || null,
    },
    ...(facts.length ? { playerFacts: facts.slice(-30).map(f => String(f).slice(0, 200)) } : {}),
    ...(page ? { currentPage: page } : {}),
    recentGames: matches.slice(0, 10).map(m => ({ hero: name(m.h), result: won(m) ? 'win' : 'loss', kda: m.k + '/' + m.de + '/' + m.a, minutes: Math.round(m.d / 60) })),
    lastGame,
    ...(draft ? { draft } : {}),
    ...(live ? { live } : {}),
    notes: notes.slice(-20).map(n => ({ text: String(n.text).slice(0, 300), atGameSeconds: n.t != null ? Math.round(n.t) : null })),
  };
}

/** Voice/text command routing. Anything that is not a command is a question for the coach. */
export function parseCommand(raw) {
  const t = String(raw || '').trim();
  const l = t.toLowerCase().replace(/[.!?]+$/, '');
  if (!l) return { type: 'empty' };
  if (/^(please )?(start|starting|begin)( the| a| my)?( new)?( game| match)?$/.test(l) || /^(game|match) (has )?(started|starting|start)$/.test(l)) return { type: 'start' };
  const note = t.match(/^(?:note|remember|log)\b[\s:,.-]*(.*)$/i);
  if (note) return note[1].trim() ? { type: 'note', text: note[1].trim() } : { type: 'note-empty' };
  if (/^(the )?(game|match) (is |has )?(finished|over|ended|done|complete)/.test(l) || /^(finished|game over|i'?m done)/.test(l) || /^(analy[sz]e|review) (my )?(last |latest )?(game|match)/.test(l)) return { type: 'finish' };
  return { type: 'question', text: t };
}

/** The first sentence (plus a second only if the first is short), for speaking aloud. Bullets are never read. */
export function speakable(answer) {
  const para = String(answer).split(/\n\s*[-*•]|\n\s*Drill:/)[0];
  const flat = para.replace(/\s+/g, ' ').trim();
  const sentences = (flat.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [flat]).map(s => s.trim());
  const out = sentences[0].length < 90 && sentences[1] ? sentences[0] + ' ' + sentences[1] : sentences[0];
  return out.slice(0, 220);
}

/** Compact draft summary for the AI: names, scored candidates with their reasons. */
export function draftSummary(draft, heroes, results) {
  if (!draft || (!draft.allies.length && !draft.enemies.length && !draft.mine)) return null;
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  return {
    ...(draft.mine ? { myHero: name(draft.mine) } : {}),
    allies: draft.allies.map(name), enemies: draft.enemies.map(name),
    topCandidates: results.slice(0, 6).map(r => ({ hero: name(r.id), scorePoints: Math.round(r.score * 1000) / 10, confidence: r.conf, reasons: r.reasons.slice(0, 5) })),
  };
}

// ---------- hero names from speech or the AI ----------

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Common community nicknames and frequent speech-recognition mishearings, mapped to name prefixes. */
const ALIASES = {
  am: 'antimage', antimage: 'antimage', pa: 'phantomassassin', pl: 'phantomlancer', wr: 'windranger', windrunner: 'windranger',
  od: 'outworld', cm: 'crystalmaiden', crystal: 'crystalmaiden', sf: 'shadowfiend', es: 'earthshaker', ember: 'emberspirit',
  storm: 'stormspirit', void: 'facelessvoid', fv: 'facelessvoid', ck: 'chaosknight', dk: 'dragonknight', wk: 'wraithking',
  ta: 'templarassassin', tb: 'terrorblade', sk: 'sandking', np: 'naturesprophet', prophet: 'naturesprophet', furion: 'naturesprophet',
  qop: 'queenofpain', bh: 'bountyhunter', bounty: 'bountyhunter', bs: 'bloodseeker', blood: 'bloodseeker', lc: 'legioncommander', legion: 'legioncommander',
  ld: 'lonedruid', druid: 'lonedruid', ss: 'shadowshaman', shaman: 'shadowshaman', rhasta: 'shadowshaman', ww: 'winterwyvern', wyvern: 'winterwyvern',
  wd: 'witchdoctor', aa: 'ancientapparition', ench: 'enchantress', jugg: 'juggernaut', jug: 'juggernaut', mk: 'monkeyking', sb: 'spiritbreaker', bara: 'spiritbreaker',
  spec: 'spectre', specter: 'spectre', ns: 'nightstalker', brood: 'broodmother', veno: 'venomancer', kotl: 'keeperofthelight', alch: 'alchemist',
  abba: 'abaddon', potm: 'mirana', centaur: 'centaurwarrunner', cent: 'centaurwarrunner', tusk: 'tusk', wisp: 'io', tinker: 'tinker',
  troll: 'trollwarlord', tw: 'trollwarlord', ogre: 'ogremagi', om: 'ogremagi', dp: 'deathprophet', sd: 'shadowdemon', lion: 'lion',
  lena: 'lina', leena: 'lina', jakiro: 'jakiro', thd: 'jakiro', doom: 'doom', magnus: 'magnus', mag: 'magnus', invo: 'invoker', voker: 'invoker',
  zeus: 'zeus', zoos: 'zeus', lesh: 'leshrac', leshrack: 'leshrac', huskar: 'huskar', husk: 'huskar', slark: 'slark', mars: 'mars',
  pango: 'pangolier', panda: 'brewmaster', brew: 'brewmaster', rubick: 'rubick', ruby: 'rubick', clinkz: 'clinkz', clink: 'clinkz',
  axe: 'axe', ax: 'axe', acts: 'axe', tide: 'tidehunter', drow: 'drowranger', sniper: 'sniper', snapfire: 'snapfire', grim: 'grimstroke',
  dazzle: 'dazzle', razor: 'razor', medusa: 'medusa', dusa: 'medusa', morph: 'morphling', naga: 'nagasiren', meepo: 'meepo', arc: 'arcwarden',
};
// Two-letter nicknames that are also ordinary words; only used when the whole phrase is the nickname.
const RISKY = new Set(['am', 'es', 'ta', 'ss', 'om', 'sd', 'tw', 'ax', 'acts']);

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

/**
 * Hero id for a spoken or written name, or null. Order: exact name, nickname, unique prefix, close spelling.
 * scan=true is stricter (used when picking names out of a whole sentence).
 */
export function resolveHero(name, heroes, { scan = false } = {}) {
  const n = norm(name);
  if (!n || n.length < 2) return null;
  const list = Object.values(heroes).map(h => ({ id: h.id, k: norm(h.name) }));
  const exact = list.find(h => h.k === n);
  if (exact) return exact.id;
  const alias = ALIASES[n];
  if (alias && !(scan && RISKY.has(n))) {
    const hit = list.filter(h => h.k.startsWith(alias));
    if (hit.length === 1) return hit[0].id;
  }
  if (n.length >= 4) {
    const pre = list.filter(h => h.k.startsWith(n));
    if (pre.length === 1) return pre[0].id;
  }
  if (n.length >= 5) {
    const max = n.length >= 8 ? 2 : 1;
    const scored = list.map(h => ({ id: h.id, d: levenshtein(n, h.k) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d);
    if (scored.length && (scored.length === 1 || scored[0].d < scored[1].d)) return scored[0].id;
  }
  return null;
}

/** Resolve several names; returns { ids, unknown }. */
export function resolveHeroes(names, heroes) {
  const ids = [], unknown = [];
  for (const nm of names || []) { const id = resolveHero(nm, heroes); if (id != null && !ids.includes(id)) ids.push(id); else if (id == null) unknown.push(nm); }
  return { ids, unknown };
}

/** Pick hero names out of free speech ("axe lina and phantom assassin"), longest phrases first. */
export function heroesInText(text, heroes) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9' -]/g, ' ').split(/[\s,]+/).filter(Boolean);
  const STOP = new Set(['and', 'the', 'a', 'an', 'is', 'are', 'has', 'have', 'got', 'with', 'also', 'plus', 'then', 'on', 'to', 'my', 'our', 'their', 'we', 'they', 'enemy', 'enemies', 'team', 'picked', 'pick', 'took', 'i', 'im', "i'm", 'me', 'add', 'remove', 'from', 'favourites', 'favorites', 'favourite', 'favorite', 'avoid', 'ally', 'allies', 'playing', 'play', 'as', 'of', 'in', 'for']);
  const ids = [];
  for (let i = 0; i < words.length;) {
    let hit = null, len = 0;
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n);
      if (n === 1 && STOP.has(phrase[0])) break;
      const id = resolveHero(phrase.join(' '), heroes, { scan: true });
      if (id != null) { hit = id; len = n; break; }
    }
    if (hit != null) { if (!ids.includes(hit)) ids.push(hit); i += len; } else i++;
  }
  return ids;
}

const PAGE_WORDS = { coach: 'coach', home: 'coach', draft: 'draft', live: 'live', heroes: 'heroes', matches: 'matches', games: 'matches', preferences: 'preferences', settings: 'preferences', prefs: 'preferences' };

/**
 * Offline command parser, used when the AI is unavailable. Returns actions in the same shape as /api/agent,
 * or [] when it cannot tell what was meant. It only handles one clear intent per sentence.
 */
export function localIntent(text, heroes) {
  const l = String(text || '').toLowerCase().trim();
  if (!l) return [];
  const enemyWord = /\b(enemy|enemies|they|their|opponents?|them)\b/.test(l);
  const allyWord = /\b(we|our|my team|ally|allies|teammates?)\b/.test(l);
  if (/\b(clear|reset|new)\b.*\bdraft\b/.test(l)) return [{ type: 'draft_clear' }];
  const nav = l.match(/\b(open|show|go to|take me to)\b(?: me)?(?: the| my)?\s+(\w+)/);
  if (nav && PAGE_WORDS[nav[2]]) return [{ type: 'navigate', page: PAGE_WORDS[nav[2]] }];
  const role = l.match(/\b(?:my role is|i play|i'm playing|i am playing|set (?:my )?role to)\s+(carry|mid|support|any)\b/);
  if (role) return [{ type: 'pref_set', field: 'role', value: role[1] === 'any' ? '' : role[1] }];
  const names = id => (heroes[id] ? heroes[id].name : String(id));
  const found = heroesInText(l, heroes).map(names);
  if (!found.length) return [];
  if (/\b(favou?rites?)\b/.test(l)) return [{ type: /\b(remove|delete|unfavou?rite)\b/.test(l) ? 'favorite_remove' : 'favorite_add', heroes: found }];
  if (/\b(avoid|never recommend|ban|hate)\b/.test(l)) return [{ type: 'avoid_add', heroes: found }];
  if (/\b(remove|delete|undo|take out)\b/.test(l)) return [{ type: 'draft_remove', ...(enemyWord ? { team: 'enemy' } : allyWord ? { team: 'ally' } : {}), heroes: found }];
  if (/\b(i'?m|i am|i'll|i will)\b.*\b(on|playing|pick|picking|play)\b/.test(l) && !enemyWord && !allyWord) return [{ type: 'draft_mine', heroes: found.slice(0, 1) }];
  if (enemyWord && !allyWord) return [{ type: 'draft_add', team: 'enemy', heroes: found }];
  if (allyWord && !enemyWord) return [{ type: 'draft_add', team: 'ally', heroes: found }];
  return [];
}

/** Split a long spoken sentence into single-intent clauses ("they have axe, we have cm, open the draft"). */
export function clauses(text) {
  const lead = '(?:we|they|enemy|enemies|our|my|i|i\'m|i am|also|plus|remove|open|show|add|never|clear)\\b';
  return String(text || '')
    .split(new RegExp(`[.;!?]|,\\s*(?=(?:and\\s+)?${lead})|\\s+(?:and|but|also|then)\\s+(?=${lead})`, 'i'))
    .map(s => (s || '').trim()).filter(Boolean);
}

/**
 * The AI occasionally misses part of a long sentence. Run the offline parser on each clause and add only
 * what the AI did not cover: heroes it never mentioned, and action kinds it did not produce.
 */
export function mergeLocalActions(aiActions, text, heroes) {
  const covered = new Set();
  for (const a of aiActions) for (const n of a.heroes || []) { const id = resolveHero(n, heroes); if (id != null) covered.add(id); }
  const has = (type, field) => aiActions.some(a => a.type === type && (!field || a.field === field));
  const extra = [];
  for (const c of clauses(text)) {
    for (const a of localIntent(c, heroes)) {
      if (a.heroes) {
        const left = a.heroes.filter(n => { const id = resolveHero(n, heroes); return id != null && !covered.has(id); });
        if (!left.length) continue;
        left.forEach(n => covered.add(resolveHero(n, heroes)));
        extra.push({ ...a, heroes: left });
      } else if (a.type === 'pref_set' ? !has('pref_set', a.field) : !has(a.type)) {
        extra.push(a);
      }
    }
  }
  return [...aiActions, ...extra];
}

/** Does this sentence ask for advice (so an answer should follow any changes it reports)? */
export const asksSomething = text => /\?|\b(what|which|who|should|how|why|best|recommend|suggest|advice|counter)\b/i.test(String(text || ''));

// ---------- focus areas (Preferences) ----------

export const FOCUS_AREAS = [
  ['deaths', 'Dying less'], ['farm', 'Farming consistently'], ['tilt', 'Tilt after losses'], ['session', 'Long sessions'],
  ['time', 'When I play'], ['duration', 'Game length'], ['party', 'Solo vs party'], ['pool', 'Hero pool'],
];
export const focusLabel = id => (FOCUS_AREAS.find(f => f[0] === id) || [null, ''])[1];

/** Move insights in the chosen focus area to the front and mark them. Returns { list, focusFound }. */
export function pinFocus(insights, focus) {
  if (!focus) return { list: insights, focusFound: null };
  const match = i => i.id.startsWith(focus + ':');
  const pinned = insights.filter(i => match(i) && i.kind === 'fault').map(i => ({ ...i, pinned: true }));
  const rest = insights.filter(i => !(match(i) && i.kind === 'fault'));
  return { list: [...pinned, ...rest], focusFound: pinned.length > 0 };
}

/** Spoken reminders for a running game: the player's own drills at set times, then a deaths check. */
export function reminderPlan(drills) {
  const plan = drills.slice(0, 3).map((d, i) => ({ at: [300, 720, 1200][i], text: `Focus point: ${d.title}. ${d.drill}` }));
  for (let k = 0; k < 10; k++) plan.push({ at: 1800 + k * 600, text: 'Quick check: how many deaths so far, and can you name the cause of each?' });
  return plan;
}

/** The reminder to speak now (the latest one that is due and unfired), plus every due id to mark as fired. */
export function dueReminder(plan, elapsedSec, fired) {
  const due = plan.filter(p => p.at <= elapsedSec && !fired.includes(p.at));
  return due.length ? { speak: due[due.length - 1], mark: due.map(p => p.at) } : null;
}

const TOPICS = [
  [/death|die|dying|dead/, 'deaths'], [/farm|gpm|cs\b|last hit|gold/, 'farm'], [/tilt|streak|after a loss|queue again|session/, 'tilt'],
  [/session|tired|stop/, 'session'], [/time|morning|evening|night|afternoon|when/, 'time'], [/long|short|length|late|early|duration/, 'duration'],
  [/party|solo|stack/, 'party'], [/pool|too many|variety|hero.*(drop|limit)/, 'pool'], [/trend|lately|recent|form|slid|improv/, 'trend'],
];

/** Plain answer from already-computed insights when the AI is unavailable. */
export function ruleAnswer(question, ctx) {
  const q = String(question).toLowerCase();
  const plan = ctx.plan || [];
  const pick = TOPICS.map(([re, id]) => (re.test(q) ? plan.find(p => p.title && matchesTopic(p, id)) : null)).find(Boolean);
  const fmt = p => [`${p.title} (${p.confidence} confidence, ${p.games} games).`, ...(p.evidence || []).slice(0, 2), p.drill ? 'Drill: ' + p.drill : ''].filter(Boolean).join('\n');
  if (/hero|pick|play|lean|learn/.test(q) && ctx.heroes && ctx.heroes.length && !pick) {
    const best = [...ctx.heroes].filter(h => h.games >= 8).sort((a, b) => parseInt(b.adjustedWinRate) - parseInt(a.adjustedWinRate)).slice(0, 3);
    if (best.length) return 'Your strongest heroes by adjusted win rate: ' + best.map(h => `${h.hero} (${h.winRate} over ${h.games} games)`).join(', ') + '.\nSee the Heroes page for the full lists.';
  }
  if (pick) return fmt(pick);
  const first = plan.find(p => p.type === 'fault');
  if (first) return 'Here is your top priority from the data (the AI is not available, so this is a rule-based answer).\n' + fmt(first);
  return 'I do not have enough synced games for a plan yet. Sync your ranked games, then ask again.';
}
function matchesTopic(p, id) {
  const t = p.title.toLowerCase();
  return { deaths: /death/, farm: /farm/, tilt: /tilt|bounce|loss|win/, session: /session|stop after/, time: /queue|play best|morning|evening|afternoon|night/, duration: /short|long|medium|game/, party: /solo|party/, pool: /pool/, trend: /upswing|sliding/ }[id].test(t);
}

/** Offline game review used when the AI cannot be reached. */
export function ruleReview(g, notes = []) {
  if (!g) return 'Not enough games to compare this one against your average yet.';
  const lines = [`${g.result === 'win' ? 'Win' : 'Loss'} on ${g.hero}, ${g.minutes} minutes, ${g.kills}/${g.deaths}/${g.assists}.`];
  if (g.deathsPerMin > g.avgDeathsPerMin * 1.3) lines.push(`More deaths than usual: ${g.deathsPerMin} per minute against your ${g.avgDeathsPerMin} average.`);
  else if (g.deathsPerMin < g.avgDeathsPerMin * 0.7) lines.push(`Cleaner than usual: ${g.deathsPerMin} deaths per minute against your ${g.avgDeathsPerMin} average.`);
  if (g.gpm != null && g.avgGpmRecent50) lines.push(`GPM ${g.gpm} against your recent average ${g.avgGpmRecent50}.`);
  if (notes.length) lines.push('Your notes: ' + notes.map(n => n.text).join('; ') + '.');
  return lines.join('\n') + '\n(Rule-based review: the AI is not available right now.)';
}
