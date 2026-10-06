// Assistant core: one conversation shared by the floating panel and the Live page.
// Owns speech in (push-to-talk and conversation mode), speech out (cloud voice with browser fallback),
// the game timer and notes, and the pipeline: local command -> AI agent (/api/agent) -> app actions -> reply.
import { store } from './store.js';
import { parseCommand, speakable, ruleAnswer, ruleReview, localIntent, mergeLocalActions, asksSomething } from './context.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const MAX_MESSAGES = 60;

/**
 * api (from main.js):
 *   hasData(): bool                     enough synced games to coach from
 *   context(extra): object              compact, number-only context for the AI
 *   heroNames(): string[]               canonical hero names (the AI must copy these)
 *   heroes(): object                    hero map, for the offline parser
 *   apply(actions): Promise<{ lines, failed }>   apply draft/pref/memory/navigation actions
 *   lastGame(): object|null             newest game against the player's norms
 *   sync(): Promise<matches>            fetch new games, newest first
 *   onGame(): void                      the game timer or notes changed
 */
export function createAssistant(api) {
  const subs = new Set();
  const st = {
    messages: store.get('convo', []).filter(m => m.kind !== 'wait'),
    status: 'idle',          // idle | listening | thinking | speaking
    interim: '',             // live transcript while the player speaks
    conversation: false,     // hands-free: listen again after every reply
    tts: store.get('tts', true),
    needPass: !store.get('passcode', ''),
    voiceSupported: !!SR,
    notice: '',
  };
  let seq = Date.now(), busy = false;

  const emit = () => subs.forEach(f => { try { f(st); } catch (e) { console.error(e); } });
  const persist = () => store.set('convo', st.messages.filter(m => m.kind !== 'wait').slice(-MAX_MESSAGES));
  function push(who, text, extra = {}) {
    const m = { id: ++seq, who, text: String(text || ''), ts: Date.now(), ...extra };
    st.messages.push(m);
    if (st.messages.length > MAX_MESSAGES + 10) st.messages.splice(0, st.messages.length - MAX_MESSAGES);
    persist(); emit();
    return m;
  }
  function drop(m) { st.messages = st.messages.filter(x => x !== m); persist(); emit(); }
  function setStatus(s) { if (st.status !== s) { st.status = s; emit(); } }
  const passcode = () => store.get('passcode', '');

  // ---------- speech out ----------
  let audio = null, speakToken = 0, ttsDown = false;

  function stopSpeaking() {
    speakToken++;
    if (audio) { audio.pause(); audio = null; }
    try { speechSynthesis.cancel(); } catch { /* not supported */ }
    if (st.status === 'speaking') setStatus('idle');
  }
  function pickVoice() {
    try {
      const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
      const score = v => (/natural|neural|online/i.test(v.name) ? 10 : 0) + (/en-(US|GB|AU)/i.test(v.lang) ? 2 : 0) + (/google|microsoft/i.test(v.name) ? 1 : 0);
      return vs.sort((a, b) => score(b) - score(a))[0] || null;
    } catch { return null; }
  }
  function afterSpeech(token) {
    if (token !== speakToken) return;
    audio = null;
    if (st.status === 'speaking') setStatus('idle');
    if (st.conversation) resumeListening();
  }
  function browserSpeak(text, token) {
    if (!('speechSynthesis' in window)) return afterSpeech(token);
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.rate = 1.02; u.pitch = 0.95;
      u.onstart = () => { if (token === speakToken) setStatus('speaking'); };
      u.onend = u.onerror = () => afterSpeech(token);
      speechSynthesis.speak(u);
    } catch { afterSpeech(token); }
  }
  /** Speak the first sentence. local=true uses the instant browser voice (no network, no cloud quota). */
  async function speak(text, { local = false } = {}) {
    const line = speakable(text);
    if (!st.tts || !line) { if (st.conversation) resumeListening(); return; }
    pauseListening();                 // never listen to our own voice
    stopSpeaking();
    const token = speakToken;
    if (!local && passcode() && !ttsDown) {
      try {
        const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-passcode': passcode() }, body: JSON.stringify({ text: line }) });
        if (!res.ok) { if ([404, 429, 503].includes(res.status)) ttsDown = true; throw new Error('tts ' + res.status); }
        const blob = await res.blob();
        if (token !== speakToken) return; // interrupted while the audio was being made
        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.onplay = () => { if (token === speakToken) setStatus('speaking'); };
        audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); afterSpeech(token); };
        await audio.play();
        return;
      } catch { if (token !== speakToken) return; }
    }
    browserSpeak(line, token);
  }

  // ---------- speech in ----------
  let rc = null, listening = false, wantListen = false;

  function listen() {
    if (!SR) { st.notice = 'Voice input needs Chrome or Edge. Typing works everywhere.'; emit(); return; }
    if (listening) return;
    wantListen = true;
    st.notice = '';
    rc = new SR();
    rc.lang = 'en-US';
    rc.continuous = st.conversation;
    rc.interimResults = true;
    rc.onresult = e => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const said = r[0].transcript.trim();
          st.interim = '';
          if (said) { pauseListening(); send(said, { voice: true }); }
        } else live += r[0].transcript;
      }
      if (live && st.interim !== live) { st.interim = live; emit(); }
    };
    rc.onerror = e => {
      const fatal = { 'not-allowed': 'Microphone access is blocked. Allow it from the icon in the address bar, or type instead.', 'service-not-allowed': 'Microphone access is blocked. Allow it from the icon in the address bar, or type instead.', 'audio-capture': 'No microphone was found. Plug one in, or type instead.', network: 'Speech recognition could not reach its service. Typing still works.' }[e.error];
      if (fatal) { wantListen = false; st.conversation = false; st.notice = fatal; emit(); }
    };
    rc.onend = () => {
      listening = false; rc = null;
      if (st.interim) { st.interim = ''; }
      if (st.status === 'listening') setStatus('idle'); else emit();
      // Conversation mode: Chrome ends sessions after silence, so start a new one while nothing else is happening.
      if (wantListen && st.conversation && !busy && st.status !== 'speaking') resumeListening();
    };
    try { rc.start(); listening = true; setStatus('listening'); } catch { listening = false; }
  }
  /** Stop listening for now without leaving conversation mode (while thinking or speaking). */
  function pauseListening() { wantListen = false; try { rc && rc.stop(); } catch { /* already stopped */ } }
  function resumeListening() { if (st.conversation && !busy && !listening) setTimeout(() => { if (st.conversation && !busy && !listening && st.status !== 'speaking') listen(); }, 250); }

  // ---------- server calls ----------
  async function post(path, body) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-passcode': passcode() }, body: JSON.stringify(body) });
    } catch { throw Object.assign(new Error('Astra\'s server cannot be reached.'), { code: 'offline' }); }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON, e.g. a static host's 404 page */ }
    if (res.ok) return data;
    throw Object.assign(new Error(data.message || 'Request failed (HTTP ' + res.status + ').'), { code: data.error || (res.status === 404 ? 'missing' : 'http') });
  }
  function explain(e) {
    if (e.code === 'passcode') { store.del('passcode'); st.needPass = true; emit(); }
    return {
      passcode: 'The passcode was not accepted.',
      busy: 'The AI is busy right now.', rate: e.message, daily: e.message,
      missing: 'This page is not served by Astra\'s server. Open it with start-astra.bat (http://localhost:3000) or your Vercel link.',
      config: 'The server has no passcode or Gemini key set.',
      offline: 'Astra\'s server is not running or this page is stale. Restart start-astra.bat, then reload.',
      upstream: 'Gemini returned an error: ' + e.message,
    }[e.code] || e.message;
  }

  // ---------- replies ----------
  /** Show an Astra message. say: speak it; local: use the instant browser voice. */
  function reply(text, { say = true, local = false, kind = '', acts = null } = {}) {
    push('astra', text, { kind, ...(acts ? { acts } : {}) });
    if (say) speak(text || (acts || []).map(a => a.label).join('. '), { local }); else if (st.conversation) resumeListening();
  }

  // ---------- game timer and notes ----------
  function gameStart(silent = false) {
    store.set('gameStart', Date.now());
    store.del('firedReminders');            // a new game gets its own reminders
    api.onGame();
    if (!silent) reply('Game timer started. Tell me what happens and I\'ll keep notes.', { local: true });
    return 'Game timer started';
  }
  function addNote(text, silent = false) {
    const t0 = store.get('gameStart');
    const notes = store.get('notes', []);
    notes.push({ ts: Date.now(), t: t0 ? (Date.now() - t0) / 1000 : null, text: String(text).slice(0, 300) });
    store.set('notes', notes.slice(-100));
    api.onGame();
    if (!silent) reply('Noted.', { local: true });
    return 'Noted: ' + text;
  }
  async function finishGame() {
    reply('Fetching your latest match…', { say: false });
    try {
      const t0 = store.get('gameStart');
      const matches = await api.sync();
      const m = matches[0];
      if (!m) throw new Error('no matches');
      // The newest match must have ended after the timer started, or OpenDota does not have this game yet.
      if (store.get('lastReviewed') === m.id || (t0 && (m.t + m.d) * 1000 < t0)) {
        return reply('No new game on OpenDota yet. It can take a few minutes after a match; say "game finished" again shortly.');
      }
      const lo = t0 || (m.t - 1800) * 1000;
      const mine = store.get('notes', []).filter(n => n.ts >= lo);
      store.set('gamenotes:' + m.id, mine);
      store.set('lastReviewed', m.id);
      store.del('gameStart'); store.del('firedReminders');
      api.onGame();
      const lastGame = api.lastGame();
      const notes = mine.map(n => ({ text: n.text, atGameSeconds: n.t != null ? Math.round(n.t) : null }));
      if (!passcode()) { st.needPass = true; emit(); return reply(ruleReview(lastGame, mine), { kind: 'offline' }); }
      busy = true; setStatus('thinking');
      const wait = push('astra', '', { kind: 'wait' });
      try {
        const r = await post('/api/ask', { question: 'Review my last game and connect my notes to the numbers.', kind: 'review', context: api.context({ lastGame, notes }) });
        drop(wait); reply(r.answer);
      } catch (e) { drop(wait); reply(explain(e) + ' Rule-based review instead:\n' + ruleReview(lastGame, mine), { kind: 'offline', say: false }); }
      finally { busy = false; if (st.status === 'thinking') setStatus('idle'); }
    } catch (e) { reply('Could not fetch the match: ' + (e.message || e) + '. Try again in a minute.'); }
  }

  // ---------- actions ----------
  /** Apply actions from the AI or the offline parser. Game actions are handled here, the rest by the app. */
  async function applyActions(actions) {
    const acts = [];
    let finish = false, draftChanged = false;
    const appActions = [];
    for (const a of actions) {
      if (a.type === 'note') acts.push({ label: addNote(a.text, true), ok: true });
      else if (a.type === 'game_start') acts.push({ label: gameStart(true), ok: true });
      else if (a.type === 'game_finish') finish = true;
      else appActions.push(a);
    }
    if (appActions.length) {
      const r = await api.apply(appActions);
      r.lines.forEach(label => acts.push({ label, ok: true }));
      r.failed.forEach(label => acts.push({ label, ok: false }));
      draftChanged = !!r.draftChanged;
    }
    return { acts, finish, draftChanged };
  }

  async function runLocal(text, why) {
    const actions = localIntent(text, api.heroes());
    if (actions.length) {
      const { acts, finish } = await applyActions(actions);
      reply(why ? why + ' I did this without the AI:' : '', { acts, local: true });
      if (finish) await finishGame();
    } else {
      reply((why ? why + ' ' : '') + 'Rule-based answer:\n' + ruleAnswer(text, api.context()), { kind: 'offline' });
    }
  }

  async function agent(text) {
    if (!api.hasData()) return reply('Sync your ranked games first, then I can help from your data.', { say: false });
    if (!passcode()) { st.needPass = true; emit(); return runLocal(text, 'The AI is locked: enter your passcode to unlock it.'); }
    busy = true; setStatus('thinking');
    const wait = push('astra', '', { kind: 'wait' });
    let out;
    try {
      out = await post('/api/agent', { text, context: api.context(), heroNames: api.heroNames() });
    } catch (e) {
      drop(wait); busy = false; setStatus('idle');
      return runLocal(text, explain(e));
    }
    drop(wait);
    try {
      // Add anything the AI missed in a long sentence (checked clause by clause, no duplicates).
      const actions = mergeLocalActions(out.actions || [], text, api.heroes());
      const { acts, finish, draftChanged } = await applyActions(actions);
      let answer = (out.reply || '').trim();
      if (draftChanged && asksSomething(text)) {
        // "They have Axe, what should I pick?": the AI answered before its picks were applied,
        // so ask again with the updated draft.
        const wait2 = push('astra', '', { kind: 'wait' });
        try { answer = (await post('/api/ask', { question: text, context: api.context() })).answer || answer; } catch { /* keep the first answer */ }
        drop(wait2);
      }
      if (answer || acts.length) reply(answer, { acts, local: !answer });
      else reply('I did not catch anything to do there. Try again, or ask me a question.', { local: true });
      if (finish) { busy = false; await finishGame(); }
    } finally { busy = false; if (st.status === 'thinking') setStatus('idle'); }
  }

  // ---------- entry point ----------
  async function send(raw, { voice = false } = {}) {
    const text = String(raw || '').trim().slice(0, 500);
    const cmd = parseCommand(text);
    if (cmd.type === 'empty') return;
    push('you', text, voice ? { voice: true } : {});
    if (cmd.type === 'start') return gameStart();
    if (cmd.type === 'note-empty') return reply('What should I note? Say note, then what happened.', { local: true });
    if (cmd.type === 'note') return addNote(cmd.text);
    if (cmd.type === 'finish') return finishGame();
    if (busy) return reply('One moment, still working on the last one.', { say: false });
    return agent(text);
  }

  // ---------- public controls ----------
  return {
    state: st,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    send,
    /** Hold-to-talk: start on press, stop on release (the final words still arrive). */
    holdStart() { stopSpeaking(); if (st.conversation) return; listen(); },
    holdEnd() { if (!st.conversation) pauseListening(); },
    /** Conversation mode: Astra listens, stops while it thinks and speaks, then listens again. */
    setConversation(on) {
      st.conversation = !!on;
      if (on) { stopSpeaking(); listen(); } else { pauseListening(); setStatus(st.status === 'listening' ? 'idle' : st.status); }
      emit();
    },
    setTts(on) { st.tts = !!on; store.set('tts', st.tts); if (!on) stopSpeaking(); emit(); },
    stopSpeaking,
    setPasscode(v) { store.set('passcode', String(v).trim()); st.needPass = false; ttsDown = false; st.notice = 'Passcode saved on this device.'; emit(); },
    /** Spoken announcement, used for game reminders. */
    say(text) { reply(text, { kind: 'reminder' }); },
    clear() { st.messages = []; persist(); emit(); },
  };
}
