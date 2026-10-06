// App controller: state, routing, events, sync orchestration.
import { parseId, get, ApiError } from './api.js';
import { store, loadPrefs, savePrefs } from './store.js';
import { loadHeroes, bracketOf, meta, loadBenchmark, loadMatchups, percentileOf } from './heroes.js';
import { previewAccount, sync, loadLocal } from './sync.js';
import { buildInsights, heroTable, heroLists, trends, heroForm, matchNotes, pickRecommendations } from './analysis.js';
import { candidatePool, scoreCandidates, compositionHints } from './draft.js';
import * as ui from './ui.js';
import { initAsk } from './ask.js';
import { buildContext, buildLastGame, draftSummary, ruleAnswer, reminderPlan, dueReminder } from './context.js';

const WINDOW = 300; // plan is based on recent form: the last N ranked games
const app = document.getElementById('app');
const navEl = document.getElementById('nav');
const syncEl = document.getElementById('sync');

const S = {
  id: store.get('id'), account: store.get('account'), heroes: null, matches: [], prefs: loadPrefs(),
  bench: {}, benchPending: false, syncing: false, shown: 30, sort: 'games', onb: {}, detail: {}, parse: {},
  draft: { allies: [], enemies: [], mode: 'enemies', q: '', ...store.get('draft', {}) }, draftResults: [], draftHints: [], draftLoading: false,
};
if (S.id) S.matches = loadLocal(S.id).matches;

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

// ---------- render ----------
async function render() {
  const r = route();
  navEl.innerHTML = S.id ? ui.nav(r) : '';
  if (typeof askUi !== 'undefined') (S.id ? askUi.show : askUi.hide)();
  if (!S.id) { setApp(ui.onboarding(S.onb)); return; }
  try {
    if (!S.heroes) { setApp(ui.skeleton()); await ensureHeroes(); }
    if (route() !== r) return; // navigated away while loading
    if (r === '/') return home();
    if (r === '/heroes') return heroesPage();
    if (r.startsWith('/hero/')) return heroPageView(Number(r.split('/')[2]));
    if (r === '/matches') return setApp(ui.matchesView(S.matches, S.shown));
    if (r.startsWith('/match/')) return matchPageView(Number(r.split('/')[2]));
    if (r === '/draft') return draftPage();
    if (r === '/live') return livePage();
    if (r === '/prefs') return setApp(ui.prefsView(S.prefs, S.heroes));
    setApp(ui.notice('err', 'Page not found. <a href="#/">Go home</a>.'));
  } catch (e) { setApp(errorHtml(e)); }
}

function insights() {
  return buildInsights(S.matches.slice(0, WINDOW), { bench: S.bench });
}

function home() {
  if (!S.matches.length) {
    setApp(S.syncing ? ui.skeleton() : `<div class="empty"><h2>No ranked games synced yet</h2><p>Sync your account to get your plan.</p><button class="pri" data-act="resync">Sync now</button></div>`);
    return;
  }
  const { rows } = rowsAndLists();
  setApp(ui.coachHome({
    account: S.account, matches: S.matches, insights: insights(),
    window: Math.min(WINDOW, S.matches.length), benchPending: S.benchPending,
    trends: trends(S.matches), recs: pickRecommendations(rows, S.matches, S.heroes, S.prefs, metaOf),
    form: heroForm(S.matches, S.heroes), lastNotes: matchNotes(S.matches[0], S.matches, S.heroes),
  }));
}

// ---------- draft ----------
const saveDraft = () => store.set('draft', { allies: S.draft.allies, enemies: S.draft.enemies, mode: S.draft.mode });

/** Score candidates against the current enemy picks (one cached matchup request per enemy). */
async function computeDraft() {
  const { rows } = rowsAndLists();
  const picked = [...S.draft.allies, ...S.draft.enemies];
  const ids = candidatePool({ rows, heroes: S.heroes, prefs: S.prefs, picked, metaOf });
  const matchupsByEnemy = {};
  S.draftLoading = true;
  if (route() === '/draft') drawDraft();
  await Promise.allSettled(S.draft.enemies.map(async e => { matchupsByEnemy[e] = await loadMatchups(e); }));
  S.draftResults = scoreCandidates({ ids, heroes: S.heroes, rows, enemies: S.draft.enemies.filter(e => matchupsByEnemy[e]), matchupsByEnemy, metaOf, prefs: S.prefs });
  S.draftHints = compositionHints(S.draft.allies, S.draft.enemies, S.heroes);
  S.draftLoading = false;
  if (route() === '/draft') drawDraft();
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

function draftContext() {
  return draftSummary(S.draft, S.heroes, S.draftResults);
}

// ---------- live game ----------
const gameStart = () => store.get('gameStart');
const drills = () => insights().filter(i => i.kind === 'fault' && i.drill).slice(0, 3);

function livePage() {
  const t0 = gameStart();
  setApp(ui.liveView({
    running: !!t0, elapsed: t0 ? (Date.now() - t0) / 1000 : 0, draft: S.draft, heroes: S.heroes, drills: drills(),
    notes: t0 ? store.get('notes', []).filter(n => n.ts >= t0) : [], reminders: store.get('reminders', true),
  }));
}

/** Once a second: update the clock and speak a reminder when one is due. Runs on every page. */
function tick() {
  const t0 = gameStart();
  if (!t0 || !S.id || !S.heroes) return;
  const elapsed = (Date.now() - t0) / 1000;
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = ui.mmss(elapsed);
  if (!store.get('reminders', true) || S.matches.length < 30) return;
  const fired = store.get('firedReminders', []);
  const due = dueReminder(reminderPlan(drills()), elapsed, fired);
  if (due) { store.set('firedReminders', [...fired, ...due.mark]); askUi.say('Reminder: ' + due.speak.text); }
}
setInterval(tick, 1000);

function rowsAndLists() {
  const rows = heroTable(S.matches, S.heroes, metaOf);
  const played = new Map(rows.map(r => [r.id, r.g]));
  return { rows, lists: heroLists(rows, S.heroes, S.prefs, metaOf, played) };
}

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
  const [mu, b] = await Promise.allSettled([loadMatchups(id), row && row.g >= 5 ? loadBenchmark(id) : Promise.resolve(null)]);
  if (route() !== '/hero/' + id) return;
  const bench = b.value;
  draw({ matchups: mu.value || null, pctGpm: bench && row ? percentileOf(bench.gold_per_min, row.gpm) : null });
}

async function matchPageView(id) {
  setApp(ui.skeleton());
  try {
    if (!S.detail[id]) S.detail[id] = await get('matches/' + id);
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
    await render();
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

// ---------- events ----------
const findHero = name => {
  const n = name.trim().toLowerCase();
  return Object.values(S.heroes).find(h => h.name.toLowerCase() === n);
};
const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

app.addEventListener('click', async e => {
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
  if (act === 'logout') { store.del('id'); store.del('account'); S.id = null; S.account = null; S.matches = []; S.bench = {}; S.onb = {}; location.hash = '#/'; return render(); }
  if (act === 'more') { S.shown += 30; return render(); }
  if (act === 'fav') { S.prefs.favorites = toggle(S.prefs.favorites, id); S.prefs.avoided = S.prefs.avoided.filter(x => x !== id); savePrefs(S.prefs); return render(); }
  if (act === 'avoid') { S.prefs.avoided = toggle(S.prefs.avoided, id); S.prefs.favorites = S.prefs.favorites.filter(x => x !== id); savePrefs(S.prefs); return render(); }
  if (act === 'rm-fav') { S.prefs.favorites = S.prefs.favorites.filter(x => x !== id); savePrefs(S.prefs); return render(); }
  if (act === 'rm-avoid') { S.prefs.avoided = S.prefs.avoided.filter(x => x !== id); savePrefs(S.prefs); return render(); }
  if (act === 'add-fav' || act === 'add-avoid') {
    const kind = act.slice(4), input = app.querySelector(`[data-add="${kind}"]`), h = findHero(input.value);
    if (!h) { input.setCustomValidity('Pick a hero from the list'); input.reportValidity(); input.setCustomValidity(''); return; }
    if (kind === 'fav') { S.prefs.favorites = [...new Set([...S.prefs.favorites, h.id])]; S.prefs.avoided = S.prefs.avoided.filter(x => x !== h.id); }
    else { S.prefs.avoided = [...new Set([...S.prefs.avoided, h.id])]; S.prefs.favorites = S.prefs.favorites.filter(x => x !== h.id); }
    savePrefs(S.prefs); return render();
  }
  if (act === 'mode') { S.draft.mode = b.dataset.mode; saveDraft(); return drawDraft(); }
  if (act === 'pick') {
    const list = S.draft[S.draft.mode], max = S.draft.mode === 'allies' ? 4 : 5;
    if (list.length >= max) { b.title = 'That team is full'; return; }
    list.push(id); S.draft.q = ''; saveDraft(); return computeDraft();
  }
  if (act === 'unpick') { S.draft[b.dataset.kind] = S.draft[b.dataset.kind].filter(x => x !== id); saveDraft(); return computeDraft(); }
  if (act === 'clear-draft') { S.draft = { ...S.draft, allies: [], enemies: [], q: '' }; S.draftResults = []; S.draftHints = []; saveDraft(); return computeDraft(); }
  if (act === 'explain-draft') {
    const ctx = askUi.ctx();
    return askUi.ask('Explain this draft: which hero should I pick from the candidates, and what is my plan for the lane and the first 10 minutes?', {
      kind: 'draft', fallback: () => ruleAnswer('hero pick', ctx) + '\n' + S.draftResults.slice(0, 3).map(r => `${S.heroes[r.id].name}: ${r.reasons.slice(0, 3).join(' ')}`).join('\n'),
    });
  }
  if (act === 'live-start') { await askUi.handle('start game'); return livePage(); }
  if (act === 'live-finish') { return askUi.handle('game finished'); }
  if (act === 'live-note') { await askUi.handle('note ' + b.dataset.text); return livePage(); }
  if (act === 'ask-open') return askUi.open();
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
  if (f.dataset.form === 'lookup') {
    const value = new FormData(f).get('pid');
    const p = parseId(value);
    if (p.error) { S.onb = { error: p.error, value }; return render(); }
    S.onb = { busy: true, value }; render();
    try { S.onb = { preview: await previewAccount(p.id) }; } catch (err) { S.onb = { error: err.message || 'Lookup failed.', value }; }
    return render();
  }
  if (f.dataset.form === 'live-note') {
    const text = String(new FormData(f).get('text') || '').trim();
    if (text) { await askUi.handle('note ' + text); livePage(); }
    return;
  }
  if (f.dataset.form === 'prefs') {
    const d = new FormData(f);
    S.prefs = { ...S.prefs, role: d.get('role') || '', goal: String(d.get('goal') || '').slice(0, 120), focus: String(d.get('focus') || '').slice(0, 300) };
    savePrefs(S.prefs);
    document.getElementById('saved').textContent = 'Saved';
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

window.addEventListener('hashchange', () => { render().then(() => app.focus({ preventScroll: true })); window.scrollTo(0, 0); });

// ---------- Ask Astra ----------
const askUi = initAsk({
  hasData: () => !!(S.id && S.heroes && S.matches.length >= 30),
  context: (extra = {}) => {
    if (!S.heroes || !S.matches.length) return {};
    const { rows } = rowsAndLists();
    const t0 = gameStart();
    return buildContext({
      account: S.account ? { ...S.account, rankName: ui.rankName(S.account.rankTier) } : null,
      matches: S.matches, insights: insights(), heroes: S.heroes, rows, prefs: S.prefs, bracketLabel: bracketLabel(),
      draft: draftContext(), live: t0 ? { gameClockMinutes: Math.floor((Date.now() - t0) / 60000) } : null, ...extra,
    });
  },
  onChange: () => { if (route() === '/live') livePage(); },
  lastGame: () => (S.heroes ? buildLastGame(S.matches, S.heroes) : null),
  sync: async () => { await runSync(); return S.matches; },
});

// ---------- boot ----------
render().then(() => { if (S.id) runSync(); });
