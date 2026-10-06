// App controller: state, routing, events, sync orchestration, and applying voice/AI actions to the app.
import { parseId, get, ApiError } from './api.js';
import { store, loadPrefs, savePrefs } from './store.js';
import { loadHeroes, bracketOf, meta, loadBenchmark, loadMatchups, percentileOf } from './heroes.js';
import { previewAccount, sync, loadLocal } from './sync.js';
import { buildInsights, heroTable, heroLists, trends, heroForm, matchNotes, pickRecommendations } from './analysis.js';
import { candidatePool, scoreCandidates, compositionHints } from './draft.js';
import * as ui from './ui.js';
import { createAssistant } from './assistant.js';
import { initAskPanel, bindHoldToTalk, bindHoldKey } from './ask.js';
import { renderConvo, statusLabel } from './convo.js';
import { buildContext, buildLastGame, draftSummary, reminderPlan, dueReminder, resolveHeroes, FOCUS_AREAS, focusLabel, pinFocus } from './context.js';

const WINDOW = 300; // plan is based on recent form: the last N ranked games
const app = document.getElementById('app');
const navEl = document.getElementById('nav');
const syncEl = document.getElementById('sync');
const $ = id => document.getElementById(id);

const S = {
  id: store.get('id'), account: store.get('account'), heroes: null, matches: [], prefs: loadPrefs(), facts: store.get('memory', []),
  bench: {}, benchPending: false, syncing: false, shown: 30, sort: 'games', onb: {}, detail: {}, parse: {}, prefsSaved: false,
  draft: { allies: [], enemies: [], mine: null, mode: 'enemies', q: '', ...store.get('draft', {}) }, draftResults: [], draftHints: [], draftLoading: false,
};
if (S.id) S.matches = loadLocal(S.id).matches;
ui.setPrefs(S.prefs);

const route = () => (location.hash.replace(/^#/, '') || '/');
const bracket = () => (S.account ? bracketOf(S.account.rankTier) : null);
const metaOf = h => meta(h, bracket());
const bracketLabel = () => (bracket() ? ui.rankName(bracket() * 10) : 'all-bracket');
const setApp = html => { app.innerHTML = html; };
const setSync = t => { syncEl.textContent = t; };

async function ensureHeroes() {
  if (S.heroes) return S.heroes;
  S.heroes = await loadHeroes();
  ui.setHeroes(S.heroes);
  return S.heroes;
}

function errorHtml(e) {
  const msg = e instanceof ApiError ? e.message : 'Something went wrong: ' + (e && e.message ? e.message : e);
  return ui.notice('err', `${ui.esc(msg)} <button class="ghost" data-act="retry">Try again</button>`);
}

// ---------- memory: things the player told Astra ----------
const saveFacts = () => store.set('memory', S.facts);
function addFact(text) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t || S.facts.some(f => f.text.toLowerCase() === t.toLowerCase())) return false;
  S.facts = [...S.facts, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), text: t }].slice(-50);
  saveFacts();
  return true;
}
/** Forget facts that mention the given text (or contain all of its meaningful words). Returns how many. */
function forgetFacts(text) {
  const q = String(text || '').toLowerCase().trim();
  if (!q) return 0;
  const words = q.split(/\W+/).filter(w => w.length >= 4);
  const hit = f => { const t = f.text.toLowerCase(); return t.includes(q) || q.includes(t) || (words.length && words.every(w => t.includes(w))); };
  const before = S.facts.length;
  S.facts = S.facts.filter(f => !hit(f));
  saveFacts();
  return before - S.facts.length;
}
// Older versions stored "focus" as free text; keep it as a remembered fact and use the new focus areas.
if (S.prefs.focus && !FOCUS_AREAS.some(f => f[0] === S.prefs.focus)) {
  addFact('Wants to work on: ' + S.prefs.focus);
  S.prefs.focus = '';
  savePrefs(S.prefs);
}

// ---------- insights (cached: the live tick reads them every second) ----------
let insightsCache = { key: '', list: [], focusFound: null };
function insightsFull() {
  const key = [S.matches.length, S.matches[0] && S.matches[0].id, Object.keys(S.bench).length, S.prefs.focus].join('|');
  if (insightsCache.key !== key) {
    const p = pinFocus(buildInsights(S.matches.slice(0, WINDOW), { bench: S.bench }), S.prefs.focus);
    insightsCache = { key, list: p.list, focusFound: p.focusFound };
  }
  return insightsCache;
}
const insights = () => insightsFull().list;
const drills = () => insights().filter(i => i.kind === 'fault' && i.drill).slice(0, 3);

function rowsAndLists() {
  const rows = heroTable(S.matches, S.heroes, metaOf);
  const played = new Map(rows.map(r => [r.id, r.g]));
  return { rows, lists: heroLists(rows, S.heroes, S.prefs, metaOf, played) };
}

// ---------- render ----------
async function render() {
  const r = route();
  navEl.innerHTML = S.id ? ui.nav(r) : '';
  if (typeof askPanel !== 'undefined') askPanel.setVisible(!!S.id && r !== '/live');
  if (!S.id) { setApp(ui.onboarding(S.onb)); return; }
  try {
    if (!S.heroes) { setApp(ui.skeleton()); await ensureHeroes(); }
    if (route() !== r) return; // navigated away while loading
    if (r === '/') return home();
    if (r === '/draft') return draftPage();
    if (r === '/live') return livePage();
    if (r === '/heroes') return heroesPage();
    if (r.startsWith('/hero/')) return heroPageView(Number(r.split('/')[2]));
    if (r === '/matches') return setApp(ui.matchesView(S.matches, S.shown));
    if (r.startsWith('/match/')) return matchPageView(Number(r.split('/')[2]));
    if (r === '/prefs') return prefsPage();
    setApp(ui.notice('err', 'Page not found. <a href="#/">Go home</a>.'));
  } catch (e) { setApp(errorHtml(e)); }
}

function home() {
  if (!S.matches.length) {
    setApp(S.syncing ? ui.skeleton() : `<div class="empty"><h2>No ranked games synced yet</h2><p>Sync your account to get your plan.</p><button class="pri" data-act="resync">Sync now</button></div>`);
    return;
  }
  const { rows } = rowsAndLists();
  const full = insightsFull();
  setApp(ui.coachHome({
    account: S.account, matches: S.matches, insights: full.list,
    window: Math.min(WINDOW, S.matches.length), benchPending: S.benchPending,
    trends: trends(S.matches), recs: pickRecommendations(rows, S.matches, S.heroes, S.prefs, metaOf),
    form: heroForm(S.matches, S.heroes), lastNotes: matchNotes(S.matches[0], S.matches, S.heroes),
    setup: { prefs: S.prefs, focusFound: full.focusFound, focusName: focusLabel(S.prefs.focus), facts: S.facts.length },
  }));
}

function prefsPage() {
  setApp(ui.prefsView({ prefs: S.prefs, heroes: S.heroes, facts: [...S.facts].reverse(), focusAreas: FOCUS_AREAS, saved: S.prefsSaved }));
  S.prefsSaved = false;
}

// ---------- draft ----------
const saveDraft = () => store.set('draft', { allies: S.draft.allies, enemies: S.draft.enemies, mine: S.draft.mine, mode: S.draft.mode });
const hasDraft = () => S.draft.allies.length || S.draft.enemies.length || S.draft.mine;
let draftSeq = 0;

/** Score candidates against the current enemy picks (one cached matchup request per enemy). Latest call wins. */
async function computeDraft() {
  const seq = ++draftSeq;
  const { rows } = rowsAndLists();
  const picked = [...S.draft.allies, ...S.draft.enemies, ...(S.draft.mine ? [S.draft.mine] : [])];
  const ids = candidatePool({ rows, heroes: S.heroes, prefs: S.prefs, picked, metaOf });
  const enemies = [...S.draft.enemies];
  const matchupsByEnemy = {};
  S.draftLoading = true;
  if (route() === '/draft') drawDraft();
  await Promise.allSettled(enemies.map(async e => { matchupsByEnemy[e] = await loadMatchups(e); }));
  if (seq !== draftSeq) return; // a newer pick started another calculation
  S.draftResults = scoreCandidates({ ids, heroes: S.heroes, rows, enemies: enemies.filter(e => matchupsByEnemy[e]), matchupsByEnemy, metaOf, prefs: S.prefs });
  S.draftHints = compositionHints(S.draft.allies, S.draft.enemies, S.heroes);
  S.draftLoading = false;
  if (route() === '/draft') drawDraft();
  if (route() === '/live') drawLiveSide();
}

function drawDraft() {
  setApp(ui.draftView({ draft: S.draft, heroes: S.heroes, results: S.draftResults, hints: S.draftHints, loading: S.draftLoading, prefs: S.prefs }));
  filterHeroGrid();
}

function filterHeroGrid() {
  const q = (S.draft.q || '').trim().toLowerCase();
  document.querySelectorAll('#hgrid .hbtn').forEach(b => { b.hidden = !!q && !b.dataset.name.includes(q); });
}

function draftPage() {
  if (S.matches.length < 10) return setApp('<div class="empty"><h2>Sync your games first</h2><p>The draft helper needs your ranked history.</p></div>');
  drawDraft();
  if (!S.draftResults.length && !S.draftLoading) computeDraft();
}

// ---------- live: conversation + game ----------
const gameStart = () => store.get('gameStart');
const gameNotes = () => { const t0 = gameStart(); return t0 ? store.get('notes', []).filter(n => n.ts >= t0) : []; };

function livePage() {
  setApp(ui.liveShell());
  bindHoldToTalk($('live-orb'), assistant);
  $('live-conv').onchange = e => assistant.setConversation(e.target.checked);
  $('live-tts').onchange = e => assistant.setTts(e.target.checked);
  drawLiveConvo(assistant.state);
  drawLiveSide();
  if (hasDraft() && !S.draftResults.length && !S.draftLoading) computeDraft();
}

function drawLiveConvo(st) {
  const log = $('live-log');
  if (!log) return;
  renderConvo(log, st);
  const pill = $('live-status');
  pill.textContent = statusLabel(st.status);
  pill.dataset.s = st.status;
  const orb = $('live-orb');
  orb.classList.toggle('on', st.status === 'listening');
  orb.classList.toggle('speaking', st.status === 'speaking');
  orb.disabled = !st.voiceSupported;
  orb.querySelector('span').textContent = !st.voiceSupported ? 'No voice' : st.conversation ? (st.status === 'listening' ? 'Listening' : 'Tap to stop') : (st.status === 'listening' ? 'Listening' : 'Hold to talk');
  $('live-pass').hidden = !st.needPass;
  $('live-notice').textContent = st.notice || (st.needPass ? 'Enter your passcode to unlock the AI. Picks, notes and settings still work without it.' : '');
  $('live-conv').checked = st.conversation;
  $('live-conv').disabled = !st.voiceSupported;
  $('live-tts').checked = st.tts;
}

function drawLiveSide() {
  const el = $('live-side');
  if (!el) return;
  const t0 = gameStart();
  el.innerHTML = ui.liveSide({
    running: !!t0, elapsed: t0 ? (Date.now() - t0) / 1000 : 0, draft: S.draft, heroes: S.heroes, drills: drills(),
    notes: gameNotes(), reminders: store.get('reminders', true), picks: S.draft.enemies.length ? S.draftResults : [], focusName: focusLabel(S.prefs.focus),
  });
}

/** Once a second: update the clock and speak a reminder when one is due. Runs on every page. */
function tick() {
  const t0 = gameStart();
  if (!t0 || !S.id || !S.heroes) return;
  const elapsed = (Date.now() - t0) / 1000;
  const clock = $('clock');
  if (clock) clock.textContent = ui.mmss(elapsed);
  if (!store.get('reminders', true) || S.matches.length < 30) return;
  const fired = store.get('firedReminders', []);
  const due = dueReminder(reminderPlan(drills()), elapsed, fired);
  if (due) { store.set('firedReminders', [...fired, ...due.mark]); assistant.say('Reminder: ' + due.speak.text); }
}
setInterval(tick, 1000);

// ---------- heroes, matches ----------
function heroesPage() {
  if (!S.matches.length) return setApp('<div class="empty"><h2>No games yet</h2><p>Sync first.</p></div>');
  const { rows, lists } = rowsAndLists();
  setApp(ui.heroesView({ rows, heroes: S.heroes, lists, bracketLabel: bracketLabel(), prefs: S.prefs, sort: S.sort }));
}

async function heroPageView(id) {
  const hero = S.heroes[id];
  const { rows } = rowsAndLists();
  const row = rows.find(r => r.id === id) || null;
  const mine = S.matches.filter(m => m.h === id);
  const draw = (extra = {}) => setApp(ui.heroPage({ hero, id, row, matches: mine, bracketLabel: bracketLabel(), prefs: S.prefs, ...extra }));
  draw({ matchups: null, pctGpm: null });
  if (!hero) return;
  const [mu, b] = await Promise.allSettled([loadMatchups(id), row && row.g >= 5 ? loadBenchmark(id) : Promise.resolve(null)]);
  if (route() !== '/hero/' + id) return;
  const bench = b.value;
  draw({ matchups: mu.value || null, pctGpm: bench && row ? percentileOf(bench.gold_per_min, row.gpm) : null });
}

async function matchPageView(id) {
  setApp(ui.skeleton());
  try {
    // After a parse request, refetch on every visit so the parsed detail appears without a full reload.
    if (!S.detail[id] || S.parse[id] === 'queued') S.detail[id] = await get('matches/' + id);
    if (S.detail[id].version != null) delete S.parse[id];
    if (route() !== '/match/' + id) return;
    const mine = S.matches.find(m => m.id === id);
    setApp(ui.matchDetail({ d: S.detail[id], meId: S.id, heroList: S.heroes, parseState: S.parse[id], notes: mine ? matchNotes(mine, S.matches, S.heroes) : [] }));
  } catch (e) { setApp(e instanceof ApiError && e.kind === 'notfound' ? ui.notice('err', 'OpenDota has no detail for this match yet.') : errorHtml(e)); }
}

// ---------- sync ----------
async function runSync({ reset = false } = {}) {
  if (S.syncing || !S.id) return;
  S.syncing = true;
  setSync('Syncing…');
  try {
    if (reset) { store.del('matches:' + S.id); S.matches = []; }
    if (route() === '/') home();
    await ensureHeroes();
    try { S.account = { ...S.account, ...(await previewAccount(S.id)) }; store.set('account', S.account); } catch (e) { if (!S.account) throw e; }
    const res = await sync(S.id);
    S.matches = res.matches;
    setSync(res.added ? `+${res.added} new game${res.added === 1 ? '' : 's'}` : 'Up to date');
    S.syncing = false;
    if (route() !== '/live') await render(); // never wipe the live conversation view
    loadBenchmarks();
  } catch (e) {
    S.syncing = false;
    setSync('Sync failed');
    if (route() === '/' || !S.matches.length) setApp(errorHtml(e));
  } finally { S.syncing = false; }
}

/** Benchmarks for the heroes you play most, so the farm insight can use percentiles. */
async function loadBenchmarks() {
  const recent = S.matches.slice(0, WINDOW), counts = new Map();
  recent.forEach(m => counts.set(m.h, (counts.get(m.h) || 0) + 1));
  const top = [...counts].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]).filter(h => !S.bench[h]);
  if (!top.length) return;
  S.benchPending = true;
  await Promise.allSettled(top.map(async h => { S.bench[h] = await loadBenchmark(h); }));
  S.benchPending = false;
  if (route() === '/') home();
}

// ---------- applying actions (from voice, the AI, or the offline parser) ----------
const heroLabel = ids => ids.map(id => (S.heroes[id] ? S.heroes[id].name : id)).join(', ');
const PAGES = { coach: '#/', draft: '#/draft', live: '#/live', heroes: '#/heroes', matches: '#/matches', preferences: '#/prefs' };
const PAGE_NAMES = { coach: 'Coach', draft: 'Draft', live: 'Live', heroes: 'Heroes', matches: 'Matches', preferences: 'Preferences', lastgame: 'your last game' };

function onPrefsChanged() {
  savePrefs(S.prefs);
  ui.setPrefs(S.prefs);
  insightsCache.key = '';
  S.draftResults = []; // the candidate pool depends on role, favourites and avoided heroes
}

/** Refresh whatever page is showing after data changed, without disturbing the Live conversation. */
async function refreshCurrent() {
  const r = route();
  if (r === '/live') return drawLiveSide();
  if (r === '/draft') return drawDraft();
  return render();
}

async function applyActions(actions) {
  const lines = [], failed = [];
  let draftChanged = false, prefsChanged = false, factsChanged = false, nav = null;
  const resolve = names => {
    const r = resolveHeroes(names, S.heroes);
    if (r.unknown.length) failed.push(`Didn't recognise ${r.unknown.map(x => '"' + x + '"').join(', ')}. Try the full hero name.`);
    return r.ids;
  };
  for (const a of actions) {
    if (a.type === 'draft_add') {
      const team = a.team === 'ally' ? 'allies' : 'enemies', other = team === 'allies' ? 'enemies' : 'allies', max = team === 'allies' ? 4 : 5;
      const added = [];
      for (const id of resolve(a.heroes)) {
        if (S.draft[team].includes(id) || id === S.draft.mine) continue;
        if (S.draft[team].length >= max) { failed.push(`${team === 'allies' ? 'Your team' : 'The enemy team'} already has ${max} heroes`); break; }
        S.draft[other] = S.draft[other].filter(x => x !== id);
        S.draft[team].push(id); added.push(id);
      }
      if (added.length) { lines.push(`${team === 'allies' ? 'Your team' : 'Enemy team'}: added ${heroLabel(added)}`); draftChanged = true; }
    } else if (a.type === 'draft_remove') {
      const ids = resolve(a.heroes);
      const teams = a.team === 'ally' ? ['allies'] : a.team === 'enemy' ? ['enemies'] : ['allies', 'enemies'];
      const removed = ids.filter(id => teams.some(t => S.draft[t].includes(id)) || id === S.draft.mine);
      teams.forEach(t => { S.draft[t] = S.draft[t].filter(x => !ids.includes(x)); });
      if (ids.includes(S.draft.mine)) S.draft.mine = null;
      if (removed.length) { lines.push(`Removed from the draft: ${heroLabel(removed)}`); draftChanged = true; }
      else if (ids.length) failed.push(`${heroLabel(ids)} ${ids.length > 1 ? 'are' : 'is'} not in the draft`);
    } else if (a.type === 'draft_clear') {
      S.draft = { ...S.draft, allies: [], enemies: [], mine: null };
      lines.push('Draft cleared'); draftChanged = true;
    } else if (a.type === 'draft_mine') {
      const [id] = resolve(a.heroes.slice(0, 1));
      if (id != null) {
        S.draft.mine = id;
        S.draft.allies = S.draft.allies.filter(x => x !== id); S.draft.enemies = S.draft.enemies.filter(x => x !== id);
        lines.push(`Your hero: ${heroLabel([id])}`); draftChanged = true;
      }
    } else if (a.type === 'pref_set') {
      const v = String(a.value || '').trim();
      if (a.field === 'role') {
        const role = ['carry', 'mid', 'support'].includes(v.toLowerCase()) ? v.toLowerCase() : ['', 'any', 'none', 'all'].includes(v.toLowerCase()) ? '' : null;
        if (role === null) failed.push(`"${v}" is not a role. Use carry, mid or support.`);
        else { S.prefs.role = role; lines.push(`Role: ${role || 'any'}`); prefsChanged = true; }
      } else if (a.field === 'goal') {
        S.prefs.goal = v.slice(0, 120); lines.push(v ? `Goal: ${S.prefs.goal}` : 'Goal cleared'); prefsChanged = true;
      } else if (a.field === 'focus') {
        const f = v.toLowerCase();
        if (!f || FOCUS_AREAS.some(x => x[0] === f)) { S.prefs.focus = f; lines.push(f ? `Focus: ${focusLabel(f)}` : 'Focus cleared'); prefsChanged = true; }
        else failed.push(`"${v}" is not a focus area. Options: ${FOCUS_AREAS.map(x => x[1].toLowerCase()).join(', ')}.`);
      }
    } else if (/^(favorite|avoid)_(add|remove)$/.test(a.type)) {
      const [kind, op] = a.type.split('_');
      const key = kind === 'favorite' ? 'favorites' : 'avoided', otherKey = kind === 'favorite' ? 'avoided' : 'favorites';
      const ids = resolve(a.heroes);
      if (!ids.length) continue;
      if (op === 'add') { S.prefs[key] = [...new Set([...S.prefs[key], ...ids])]; S.prefs[otherKey] = S.prefs[otherKey].filter(x => !ids.includes(x)); }
      else S.prefs[key] = S.prefs[key].filter(x => !ids.includes(x));
      lines.push(`${kind === 'favorite' ? 'Favourites' : 'Avoided heroes'}: ${op === 'add' ? 'added' : 'removed'} ${heroLabel(ids)}`);
      prefsChanged = true;
    } else if (a.type === 'remember') {
      if (addFact(a.text)) { lines.push(`Remembered: ${a.text}`); factsChanged = true; } else lines.push(`Already remembered: ${a.text}`);
    } else if (a.type === 'forget') {
      const n = forgetFacts(a.text);
      if (n) { lines.push(`Forgot ${n} thing${n > 1 ? 's' : ''} about "${a.text}"`); factsChanged = true; } else failed.push(`Nothing remembered about "${a.text}"`);
    } else if (a.type === 'navigate') nav = a;
  }
  if (prefsChanged) onPrefsChanged();
  if (draftChanged || (prefsChanged && hasDraft())) {
    saveDraft();
    await computeDraft();
    const best = S.draftResults.slice(0, 2);
    if (draftChanged && S.draft.enemies.length && best.length) lines.push(`Best pick now: ${best.map(r => `${S.heroes[r.id].name} (${r.score >= 0 ? '+' : ''}${(r.score * 100).toFixed(1)})`).join(', then ')}`);
  }
  if (nav) {
    let hash = PAGES[nav.page];
    if (nav.page === 'lastgame' && S.matches[0]) hash = '#/match/' + S.matches[0].id;
    if (nav.page === 'hero') { const [id] = resolve(nav.heroes || []); if (id != null) hash = '#/hero/' + id; }
    if (hash) { lines.push(`Opened ${nav.page === 'hero' ? 'the hero page' : PAGE_NAMES[nav.page]}`); location.hash = hash; }
    else failed.push('Could not find that page');
  } else if (prefsChanged || factsChanged || draftChanged) await refreshCurrent();
  return { lines, failed, draftChanged };
}

// ---------- assistant ----------
const assistant = createAssistant({
  hasData: () => !!(S.id && S.heroes && S.matches.length >= 30),
  context: (extra = {}) => {
    if (!S.heroes || !S.matches.length) return {};
    const { rows } = rowsAndLists();
    const t0 = gameStart();
    return buildContext({
      account: S.account ? { ...S.account, rankName: ui.rankName(S.account.rankTier) } : null,
      matches: S.matches, insights: insights(), heroes: S.heroes, rows, prefs: S.prefs, bracketLabel: bracketLabel(),
      draft: draftSummary(S.draft, S.heroes, S.draftResults),
      live: t0 ? { gameClockMinutes: Math.floor((Date.now() - t0) / 60000) } : null,
      notes: gameNotes().map(n => ({ text: n.text, t: n.t })),
      facts: S.facts.map(f => f.text), page: route(),
      ...extra,
    });
  },
  heroNames: () => (S.heroes ? Object.values(S.heroes).map(h => h.name) : []),
  heroes: () => S.heroes || {},
  apply: applyActions,
  lastGame: () => (S.heroes ? buildLastGame(S.matches, S.heroes) : null),
  sync: async () => { await runSync(); return S.matches; },
  onGame: () => { if (route() === '/live') drawLiveSide(); },
});
const askPanel = initAskPanel(assistant);
bindHoldKey(assistant);
assistant.subscribe(st => { if (route() === '/live') drawLiveConvo(st); });

// ---------- events ----------
const findHero = name => {
  const n = name.trim().toLowerCase();
  return Object.values(S.heroes).find(h => h.name.toLowerCase() === n);
};
const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
const prefsDone = () => { onPrefsChanged(); return render(); };

app.addEventListener('click', async e => {
  const say = e.target.closest('[data-say]');
  if (say) return assistant.send(say.dataset.say);
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, id = Number(b.dataset.id);
  if (act === 'retry') return render();
  if (act === 'reset') { S.onb = {}; return render(); }
  if (act === 'confirm') {
    const p = S.onb.preview;
    S.id = p.id; S.account = p; store.set('id', S.id); store.set('account', p); S.onb = {};
    S.matches = [];
    location.hash = '#/';
    setApp(ui.skeleton());
    return runSync();
  }
  if (act === 'resync') return runSync({ reset: true });
  if (act === 'logout') { store.del('id'); store.del('account'); S.id = null; S.account = null; S.matches = []; S.bench = {}; S.onb = {}; insightsCache.key = ''; location.hash = '#/'; return render(); }
  if (act === 'more') { S.shown += 30; return render(); }
  if (act === 'fav') { S.prefs.favorites = toggle(S.prefs.favorites, id); S.prefs.avoided = S.prefs.avoided.filter(x => x !== id); return prefsDone(); }
  if (act === 'avoid') { S.prefs.avoided = toggle(S.prefs.avoided, id); S.prefs.favorites = S.prefs.favorites.filter(x => x !== id); return prefsDone(); }
  if (act === 'rm-fav') { S.prefs.favorites = S.prefs.favorites.filter(x => x !== id); return prefsDone(); }
  if (act === 'rm-avoid') { S.prefs.avoided = S.prefs.avoided.filter(x => x !== id); return prefsDone(); }
  if (act === 'add-fav' || act === 'add-avoid') {
    const kind = act.slice(4), input = app.querySelector(`[data-add="${kind}"]`), h = findHero(input.value);
    if (!h) { input.setCustomValidity('Pick a hero from the list'); input.reportValidity(); input.setCustomValidity(''); return; }
    if (kind === 'fav') { S.prefs.favorites = [...new Set([...S.prefs.favorites, h.id])]; S.prefs.avoided = S.prefs.avoided.filter(x => x !== h.id); }
    else { S.prefs.avoided = [...new Set([...S.prefs.avoided, h.id])]; S.prefs.favorites = S.prefs.favorites.filter(x => x !== h.id); }
    return prefsDone();
  }
  if (act === 'rm-fact') { S.facts = S.facts.filter(f => f.id !== b.dataset.fid); saveFacts(); return render(); }
  if (act === 'convo-clear') return assistant.clear();
  if (act === 'mode') { S.draft.mode = b.dataset.mode; saveDraft(); return drawDraft(); }
  if (act === 'pick') {
    const list = S.draft[S.draft.mode], max = S.draft.mode === 'allies' ? 4 : 5;
    if (list.length >= max) { b.title = 'That team is full'; return; }
    list.push(id); S.draft.q = ''; saveDraft(); return computeDraft();
  }
  if (act === 'unpick') { S.draft[b.dataset.kind] = S.draft[b.dataset.kind].filter(x => x !== id); saveDraft(); return computeDraft(); }
  if (act === 'unmine') { S.draft.mine = null; saveDraft(); return computeDraft(); }
  if (act === 'clear-draft') { S.draft = { ...S.draft, allies: [], enemies: [], mine: null, q: '' }; S.draftResults = []; S.draftHints = []; saveDraft(); return computeDraft(); }
  if (act === 'explain-draft') { askPanel.open(); return assistant.send('Which hero should I pick from the candidates, and what is my plan for the first 10 minutes?'); }
  if (act === 'live-start') return assistant.send('start game');
  if (act === 'live-finish') return assistant.send('game finished');
  if (act === 'live-note') return assistant.send('note ' + b.dataset.text);
  if (act === 'parse') {
    b.disabled = true;
    try { await get('request/' + id, { method: 'POST', retries: 1 }); S.parse[id] = 'queued'; } catch { S.parse[id] = 'error'; }
    return matchPageView(id);
  }
});

app.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const data = new FormData(f);
  if (f.dataset.form === 'lookup') {
    const value = data.get('pid');
    const p = parseId(value);
    if (p.error) { S.onb = { error: p.error, value }; return render(); }
    S.onb = { busy: true, value }; render();
    try { S.onb = { preview: await previewAccount(p.id) }; } catch (err) { S.onb = { error: err.message || 'Lookup failed.', value }; }
    return render();
  }
  if (f.dataset.form === 'live-say') {
    const input = f.querySelector('input');
    const text = input.value; input.value = '';
    return assistant.send(text);
  }
  if (f.dataset.form === 'live-pass') {
    const v = String(data.get('pass') || '').trim();
    if (v) { assistant.setPasscode(v); f.reset(); }
    return;
  }
  if (f.dataset.form === 'add-fact') {
    if (addFact(data.get('text'))) render();
    return;
  }
  if (f.dataset.form === 'prefs') {
    const focus = String(data.get('focus') || '');
    S.prefs = { ...S.prefs, role: data.get('role') || '', goal: String(data.get('goal') || '').trim().slice(0, 120), focus: FOCUS_AREAS.some(x => x[0] === focus) ? focus : '' };
    S.prefsSaved = true;
    return prefsDone();
  }
});

app.addEventListener('change', e => {
  if (e.target.matches('[data-sort]')) { S.sort = e.target.value; render(); }
  if (e.target.matches('[data-act=reminders]')) store.set('reminders', e.target.checked);
});
app.addEventListener('input', e => {
  if (e.target.id === 'hsearch') { S.draft.q = e.target.value; filterHeroGrid(); }
});

// Portraits and avatars that fail to load fall back to initials.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.ini) return;
  const s = document.createElement('span');
  s.className = img.className + ' fb';
  s.textContent = img.dataset.ini;
  img.replaceWith(s);
}, true);

// The skip link must not change the hash (the router would treat "#app" as a page).
document.querySelector('.skip').addEventListener('click', e => { e.preventDefault(); app.focus(); });

window.addEventListener('hashchange', () => { render().then(() => app.focus({ preventScroll: true })); window.scrollTo(0, 0); });

// ---------- boot ----------
render().then(() => { if (S.id) runSync(); });
