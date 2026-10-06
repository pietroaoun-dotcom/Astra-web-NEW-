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
export function buildContext({ account, matches, insights, heroes, rows, prefs, bracketLabel, notes = [], lastGame = null, draft = null, live = null }) {
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
  if (!draft || (!draft.allies.length && !draft.enemies.length)) return null;
  const name = id => (heroes[id] ? heroes[id].name : 'Hero ' + id);
  return {
    allies: draft.allies.map(name), enemies: draft.enemies.map(name),
    topCandidates: results.slice(0, 6).map(r => ({ hero: name(r.id), scorePoints: Math.round(r.score * 1000) / 10, confidence: r.conf, reasons: r.reasons.slice(0, 5) })),
  };
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
