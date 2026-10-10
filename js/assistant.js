// Assistant core: one conversation shared by the floating panel and the Live page.
// Owns speech in (push-to-talk and conversation mode), speech out (cloud voice with browser fallback),
// the game timer and notes, and the pipeline: local command -> AI agent (/api/agent) -> app actions -> reply.
import { store } from './store.js';
import { parseCommand, speakable, ruleAnswer, ruleReview, localIntent, localAll, mergeLocalActions, asksSomething } from './context.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const MAX_MESSAGES = 60;
// Phones and tablets (iPadOS reports itself as a Mac with touch). On these, the microphone and the speaker share
// one audio session: listening while Astra talks mutes or reroutes the voice, so listening waits until it ends.
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

/** A 0.1 s silent WAV, played on the first tap to unlock audio on phones. */
function silentWavUrl() {
  const n = 800, b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 16000, true);
  b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

/**
 * api (from main.js):
 *   hasData(): bool                     enough synced games to coach from
 *   context(extra): object              compact, number-only context for the AI
 *   query(requests): object[]           run the AI's data requests over the full match history
 *   autoQuery(text): object[]           the slices a question obviously needs (heroes, periods it names)
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
    needPass: false,        // only true if the server is locked (ASTRA_LOCKED=1) and refuses us
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
  // Voice settings (saved with the profile): engine 'auto' | 'browser' | 'cloud', a browser voice name, speed.
  // Natural browser voices (Microsoft Edge's "Natural" voices) sound human and start instantly; the cloud voice
  // has a very small free quota (measured: refused after a few requests) and takes 2-3 seconds per sentence.
  const voiceCfg = () => ({ engine: 'auto', name: '', rate: 1.05, ...store.get('voice', {}) });
  let audio = null, speakToken = 0, ttsDown = false, speakingLine = '';
  let utterance = null; // kept referenced: Chrome can garbage-collect a playing utterance and never fire onend

  // Phone browsers only allow sound that starts from a tap. Replies arrive seconds later, so on the first tap we
  // play silence through both voices; the browser then lets this page speak for the rest of the visit. The cloud
  // voice reuses this one unlocked audio element (iOS only trusts elements that were first played from a tap).
  const player = typeof Audio === 'function' ? new Audio() : null;
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* no speech synthesis */ }
    try { if (player) { player.src = silentWavUrl(); player.play().catch(() => { unlocked = false; }); } } catch { unlocked = false; }
  }
  for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(ev, unlockAudio, { capture: true, passive: true });

  function stopSpeaking() {
    speakToken++;
    if (audio) { audio.pause(); audio.onended = audio.onerror = null; audio = null; }
    try { speechSynthesis.cancel(); } catch { /* not supported */ }
    if (st.status === 'speaking') setStatus('idle');
  }
  /** English voices this browser offers, best first. */
  function voices() {
    try {
      const score = v => (/natural|neural/i.test(v.name) ? 20 : 0) + (/online/i.test(v.name) ? 8 : 0) + (/google/i.test(v.name) ? 4 : 0) + (/en-(US|GB)/i.test(v.lang) ? 2 : 0);
      return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a));
    } catch { return []; }
  }
  const isNatural = v => !!v && /natural|neural/i.test(v.name);
  function pickVoice() { const cfg = voiceCfg(), vs = voices(); return (cfg.name && vs.find(v => v.name === cfg.name)) || vs[0] || null; }
  function useCloud(local) {
    const cfg = voiceCfg();
    if (local || ttsDown || cfg.engine === 'browser') return false;
    if (cfg.engine === 'cloud') return true;
    return false; // auto: always the instant browser voice; the cloud voice adds 2-3 s and has a tiny free quota
  }
  const speakingNow = () => st.status === 'speaking' || !!(audio && !audio.paused) || (('speechSynthesis' in window) && speechSynthesis.speaking);
  function afterSpeech(token) {
    if (token !== speakToken) return;
    audio = null;
    setTimeout(() => { if (token === speakToken) speakingLine = ''; }, 1500); // the echo tail can arrive late
    if (st.status === 'speaking') setStatus('idle');
    if (st.conversation) resumeListening();
  }
  function browserSpeak(text, token) {
    if (!('speechSynthesis' in window)) return afterSpeech(token);
    // Mobile Chrome drops an utterance queued in the same instant as cancel(), so start it a moment later.
    setTimeout(() => {
      if (token !== speakToken) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
        u.rate = Math.min(1.5, Math.max(0.8, voiceCfg().rate));
        let started = false;
        u.onstart = () => { started = true; if (token === speakToken) setStatus('speaking'); };
        u.onend = u.onerror = () => { utterance = null; afterSpeech(token); };
        utterance = u;
        speechSynthesis.resume(); // Safari and Chrome can be left paused (after a call, or a backgrounded tab)
        speechSynthesis.speak(u);
        // Some phones refuse silently (no tap yet, or the browser blocked it): say so instead of failing quietly.
        setTimeout(() => {
          if (started || token !== speakToken || speechSynthesis.speaking) return;
          st.notice = MOBILE ? 'Your phone blocked the voice. Tap anywhere on the page once, check the silent switch and media volume, then try again.' : 'The browser did not play the voice. Click the page once, then try again.';
          unlocked = false;
          afterSpeech(token);
        }, 3000);
      } catch { afterSpeech(token); }
    }, 80);
  }
  /** Speak the first sentence. In conversation mode Astra keeps listening, so talking over it interrupts it. */
  async function speak(text, { local = false } = {}) {
    const line = speakable(text);
    if (!st.tts || !line) { if (st.conversation) resumeListening(); return; }
    if (!st.conversation) pauseListening();
    stopSpeaking();
    const token = speakToken;
    speakingLine = line;
    if (st.conversation && !MOBILE) resumeListening(); // desktop: keep listening so you can talk over Astra
    else if (st.conversation) pauseListening();       // phone: the mic would mute the voice; listen after it ends
    if (useCloud(local)) {
      try {
        const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-passcode': passcode() }, body: JSON.stringify({ text: line }) });
        if (!res.ok) { if ([404, 429, 503].includes(res.status)) ttsDown = true; throw new Error('tts ' + res.status); }
        const blob = await res.blob();
        if (token !== speakToken) return; // interrupted while the audio was being made
        const url = URL.createObjectURL(blob);
        audio = player || new Audio();
        audio.src = url;
        audio.onplay = () => { if (token === speakToken) setStatus('speaking'); };
        audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); afterSpeech(token); };
        await audio.play();
        return;
      } catch { if (token !== speakToken) return; }
    }
    browserSpeak(line, token);
  }

  // ---------- speech in ----------
  let rc = null, listening = false, wantListen = false, holding = false, silenceTimer = null, sent = false;
  const SILENCE_MS = 700;
  /** Send what was heard once per listening session (whichever comes first: silence, release, or Chrome's final). */
  function finish(text) {
    clearTimeout(silenceTimer);
    const t = String(text || '').trim();
    if (sent || !t) return;
    sent = true; st.interim = '';
    pauseListening();
    send(t, { voice: true });
  }

  /** Is this transcript just Astra's own voice coming back through the speakers? */
  function isEcho(said) {
    if (!speakingLine || !said) return false;
    const words = said.toLowerCase().match(/[a-z0-9']+/g) || [];
    if (!words.length) return false;
    const line = new Set(speakingLine.toLowerCase().match(/[a-z0-9']+/g) || []);
    return words.filter(w => line.has(w)).length / words.length >= 0.6;
  }

  function listen() {
    if (!SR) { st.notice = 'Voice input needs Chrome or Edge. Typing works everywhere.'; emit(); return; }
    if (listening) return;
    wantListen = true;
    st.notice = '';
    sent = false;
    rc = new SR();
    const session = rc;
    rc.lang = 'en-US';
    rc.continuous = st.conversation;
    rc.interimResults = true;
    rc.onresult = e => {
      let live = '';
      clearTimeout(silenceTimer);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const said = r[0].transcript.trim();
        if (isEcho(said)) continue;
        // Barge-in: the player started talking over Astra, so stop speaking straight away.
        if (speakingNow() && said.split(/\s+/).filter(Boolean).length >= 2) stopSpeaking();
        if (r.isFinal) finish(said);
        else live += r[0].transcript;
      }
      if (sent) return;
      if (st.interim !== live) { st.interim = live; emit(); }
      // Hands-free: a short pause means you're done; no need to wait for Chrome to decide.
      if (live.trim() && !holding && !speakingNow()) silenceTimer = setTimeout(() => { if (rc === session) finish(st.interim); }, SILENCE_MS);
    };
    rc.onerror = e => {
      const fatal = { 'not-allowed': 'Microphone access is blocked. Allow it from the icon in the address bar, or type instead.', 'service-not-allowed': 'Microphone access is blocked. Allow it from the icon in the address bar, or type instead.', 'audio-capture': 'No microphone was found. Plug one in, or type instead.', network: 'Speech recognition could not reach its service. Typing still works.' }[e.error];
      if (fatal) { wantListen = false; st.conversation = false; st.notice = fatal; emit(); }
    };
    rc.onend = () => {
      clearTimeout(silenceTimer);
      if (!sent && st.interim && rc === session) finish(st.interim); // never drop words that were heard
      listening = false; rc = null;
      if (st.interim) { st.interim = ''; }
      if (st.status === 'listening') setStatus('idle'); else emit();
      // Conversation mode: Chrome ends sessions after silence, so start a new one unless Astra is thinking.
      if (wantListen && st.conversation && !busy) resumeListening();
    };
    try { rc.start(); listening = true; if (!speakingNow()) setStatus('listening'); } catch { listening = false; }
  }
  /** Stop listening for now without leaving conversation mode (while thinking). */
  function pauseListening() { wantListen = false; try { rc && rc.stop(); } catch { /* already stopped */ } }
  function resumeListening() { if (st.conversation && !listening) setTimeout(() => { if (st.conversation && !busy && !listening && !(MOBILE && speakingNow())) listen(); }, 250); }

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
      busy = true; setStatus('thinking');
      const wait = push('astra', '', { kind: 'wait' });
      try {
        const r = await post('/api/ask', { question: 'Review my last game and connect my notes to the numbers.', kind: 'review', context: api.context({ lastGame, notes, queryResults: lastGame ? safe(() => api.query([{ label: `Your record on ${lastGame.hero}`, hero: [lastGame.hero], groupBy: 'month', limit: 6 }])) : [] }) });
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

  /** The last few turns before this one, so follow-ups ("what about Lina?") keep their meaning. */
  function history() {
    const turns = st.messages.filter(m => m.kind !== 'wait' && m.kind !== 'reminder' && m.text).slice(0, -1).slice(-8);
    return turns.map(m => ({ who: m.who === 'you' ? 'player' : 'astra', text: m.text.slice(0, 500) }));
  }
  const safe = f => { try { return f() || []; } catch (e) { console.error(e); return []; } };
  /** Context for one question: the summary, the conversation so far, and the slices of history it needs. */
  function questionContext(text, requested = []) {
    // The AI's own requests come first; the automatic slices are dropped from the end if the request grows too big.
    const queryResults = [...requested, ...safe(() => api.autoQuery(text))];
    while (queryResults.length > requested.length && JSON.stringify(queryResults).length > 16000) queryResults.pop();
    return api.context({ history: history(), ...(queryResults.length ? { queryResults } : {}) });
  }

  async function agent(text) {
    if (!api.hasData()) return reply('Sync your ranked games first, then I can help from your data.', { say: false });
    busy = true; setStatus('thinking');
    const wait = push('astra', '', { kind: 'wait' });
    let out;
    try {
      out = await post('/api/agent', { text, context: questionContext(text), heroNames: api.heroNames() });
      // The AI asked for numbers it did not have: run them over the full history and ask once more.
      if (out.requests && out.requests.length) {
        const results = safe(() => api.query(out.requests));
        try {
          const again = await post('/api/agent', { text, final: true, context: questionContext(text, results), heroNames: api.heroNames() });
          out = { ...out, reply: again.reply || out.reply };
        } catch { /* keep the first reply and its actions */ }
      }
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
        try { answer = (await post('/api/ask', { question: text, context: questionContext(text) })).answer || answer; } catch { /* keep the first answer */ }
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
    if (cmd.type === 'remember') { const { acts } = await applyActions([{ type: 'remember', text: cmd.text }]); return reply('', { acts, local: true }); }
    if (cmd.type === 'finish') return finishGame();
    // Instant path: clear commands (picks, settings, navigation) are applied without waiting for the AI.
    const quick = localAll(text, api.heroes());
    if (quick) {
      const { acts, finish } = await applyActions(quick);
      reply('', { acts, local: true });
      if (finish) await finishGame();
      return;
    }
    if (busy) return reply('One moment, still working on the last one.', { say: false });
    return agent(text);
  }

  // ---------- public controls ----------
  return {
    state: st,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    send,
    /** Hold-to-talk: start on press, stop on release (the final words still arrive). */
    holdStart() { stopSpeaking(); if (st.conversation) return; holding = true; listen(); },
    holdEnd() { holding = false; if (st.conversation) return; if (st.interim) finish(st.interim); else pauseListening(); },
    /** Conversation mode: Astra listens, stops while it thinks and speaks, then listens again. */
    setConversation(on) {
      st.conversation = !!on;
      if (on) { stopSpeaking(); listen(); } else { pauseListening(); setStatus(st.status === 'listening' ? 'idle' : st.status); }
      emit();
    },
    setTts(on) { st.tts = !!on; store.set('tts', st.tts); if (!on) stopSpeaking(); emit(); },
    stopSpeaking,
    setPasscode(v) { store.set('passcode', String(v).trim()); st.needPass = false; ttsDown = false; st.notice = 'Passcode saved on this device.'; emit(); if (api.onPasscode) api.onPasscode(); },
    /** Re-read the conversation and settings after the profile was loaded from the server. */
    reload() { st.messages = store.get('convo', []).filter(m => m.kind !== 'wait'); st.tts = store.get('tts', true); emit(); },
    voices: () => voices().map(v => ({ name: v.name, lang: v.lang, natural: isNatural(v) })),
    context: extra => api.context(extra),
    testVoice() { speak('Hey, I am Astra. Tell me the enemy picks and I will tell you what to play.'); },
    get engine() { return useCloud(false) ? 'cloud' : (isNatural(pickVoice()) ? 'natural' : 'basic'); },
    /** Spoken announcement, used for game reminders. */
    say(text) { reply(text, { kind: 'reminder' }); },
    clear() { st.messages = []; persist(); emit(); },
  };
}
