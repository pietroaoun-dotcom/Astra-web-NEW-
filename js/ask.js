// "Ask Astra": chat panel, push-to-talk voice, game timer and notes, AI call with rule-based fallback.
import { store } from './store.js';
import { esc } from './ui.js';
import { parseCommand, speakable, ruleAnswer, ruleReview } from './context.js';

const SUGGESTIONS = ['What should I fix first?', 'Which heroes should I lean on?', 'Am I tilting after losses?'];
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * api: { context(extra), lastGame(), sync(): Promise<matches>, hasData(): bool }
 * context() returns the compact context object; sync() refreshes matches and returns them newest-first.
 */
export function initAsk(api) {
  const root = document.createElement('div');
  root.innerHTML = `
<button id="ask-fab" class="pri" aria-haspopup="dialog" aria-controls="ask">
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z" fill="#fff"/></svg> Ask Astra</button>
<aside id="ask" role="dialog" aria-label="Ask Astra" hidden>
  <header><b>Ask Astra</b><button class="ghost" id="ask-close" aria-label="Close">Close</button></header>
  <div id="ask-log" aria-live="polite"></div>
  <div id="ask-chips" class="chips"></div>
  <p id="ask-status" class="mu sm" aria-live="polite"></p>
  <form id="ask-pass" class="row" hidden>
    <input type="password" id="ask-pass-in" class="grow" placeholder="Passcode" autocomplete="current-password" aria-label="Astra passcode">
    <button class="pri">Unlock</button></form>
  <div class="orbrow">
    <button id="ask-orb" type="button" aria-label="Hold to talk"><i></i><span>Hold to talk</span></button>
    <div class="orbopts">
      <label class="sm mu"><input type="checkbox" id="ask-hf"> Hands-free</label>
      <label class="sm mu"><input type="checkbox" id="ask-tts" checked> Speak replies</label>
    </div></div>
  <form id="ask-form" class="row"><input id="ask-in" class="grow" maxlength="500" placeholder="Ask, or: start game / note … / game finished" aria-label="Ask Astra" autocomplete="off"><button class="pri">Send</button></form>
  <p class="mu sm" id="ask-hint">Voice listens to everything while it is on, including voice chat. Use hold-to-talk in games.</p>
</aside>`;
  document.body.append(root);
  const $ = s => root.querySelector(s);
  const panel = $('#ask'), log = $('#ask-log'), status = $('#ask-status'), orb = $('#ask-orb');

  // ---------- state ----------
  let t0 = store.get('gameStart'); // ms epoch when the user said "start game"
  let notes = store.get('notes', []);
  let busy = false, speaking = false, listening = false, rc = null, wantListen = false, heldKey = false;
  const passcode = () => store.get('passcode', '');
  const setStatus = t => { status.textContent = t; };
  const refreshStatus = () => setStatus(t0 ? `Game timer running (${Math.floor((Date.now() - t0) / 60000)} min). ${notes.filter(n => n.ts >= t0).length} note(s) this game.` : '');

  // ---------- log + speech ----------
  function line(who, text, cls = '') {
    const p = document.createElement('p');
    p.className = cls;
    p.innerHTML = `<b>${esc(who)}</b> ${esc(text).replace(/\n/g, '<br>')}`;
    log.append(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }
  // Natural voice from the server (Gemini TTS); falls back to the best voice the browser has.
  let audio = null, speakToken = 0, ttsDown = false;
  function stopSpeaking() {
    speakToken++; speaking = false;
    if (audio) { audio.pause(); audio = null; }
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    const score = v => (/natural|neural|online/i.test(v.name) ? 10 : 0) + (/en-(US|GB|AU)/i.test(v.lang) ? 2 : 0) + (/google|microsoft|samantha|daniel/i.test(v.name) ? 1 : 0);
    return vs.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function browserSpeak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.rate = 1.02; u.pitch = 0.95;
      u.onstart = () => { speaking = true; };
      u.onend = u.onerror = () => { speaking = false; };
      speechSynthesis.speak(u);
    } catch { speaking = false; }
  }
  async function speak(text, { local = false } = {}) {
    if (!$('#ask-tts').checked) return;
    const line = speakable(text);
    stopSpeaking();
    const token = speakToken;
    // Short acknowledgements use the instant browser voice: no network delay, no cloud quota.
    if (passcode() && !ttsDown && !local) {
      try {
        const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-passcode': passcode() }, body: JSON.stringify({ text: line }) });
        if (!res.ok) { if (res.status === 429 || res.status === 503 || res.status === 404) ttsDown = true; throw new Error('tts ' + res.status); }
        const blob = await res.blob();
        if (token !== speakToken) return; // a newer reply or the user interrupted
        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        speaking = true;
        audio.onended = audio.onerror = () => { speaking = false; URL.revokeObjectURL(url); };
        await audio.play();
        return;
      } catch { speaking = false; if (token !== speakToken) return; }
    }
    browserSpeak(line);
  }
  function reply(text, { say = true, cls = '', local = false } = {}) { line('Astra', text, cls); if (say) speak(text, { local }); }

  // ---------- AI call ----------
  async function askServer(question, { kind = 'quick', extra = {} } = {}) {
    let res;
    try {
      res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-astra-passcode': passcode() },
        body: JSON.stringify({ question, kind, context: api.context(extra) }),
      });
    } catch {
      const err = new Error('Astra\'s server cannot be reached.');
      err.code = 'offline';
      throw err;
    }
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON, e.g. 404 from a static host */ }
    if (res.ok && body.answer) return body.answer;
    const err = new Error(body.message || (res.status === 404 ? 'The AI endpoint is not available here.' : 'AI request failed (HTTP ' + res.status + ').'));
    err.code = body.error || (res.status === 404 ? 'missing' : 'http');
    throw err;
  }

  async function answer(question, { kind = 'quick', extra = {}, fallback } = {}) {
    if (!api.hasData()) { reply('Sync your ranked games first, then I can answer from your data.', { say: false }); return; }
    if (!passcode()) { showPass('Enter your passcode to unlock the AI.'); line('Astra', 'The AI is locked. Rule-based answer for now:\n' + fallback(), 'offline'); return; }
    const wait = line('Astra', 'Thinking…', 'wait');
    busy = true;
    try {
      const a = await askServer(question, { kind, extra });
      wait.remove(); reply(a);
    } catch (e) {
      wait.remove();
      if (e.code === 'passcode') { store.del('passcode'); showPass('That passcode was not accepted.'); }
      const why = { passcode: 'The passcode was wrong.', rate: e.message, daily: e.message, busy: 'The AI is busy right now.', missing: 'This page is not served by Astra\'s server (no /api/ask). Open it through start-astra.bat at http://localhost:3000.', config: 'The server has no passcode or Gemini key. Check .env.local, then restart start-astra.bat.', offline: 'Astra\'s server is not running or this page is stale. Double-click start-astra.bat, then reload this page.', upstream: 'Gemini returned an error: ' + e.message }[e.code] || e.message;
      reply(`${why} Here is a rule-based answer instead:\n${fallback()}`, { say: false, cls: 'offline' });
      speak(fallback());
    } finally { busy = false; }
  }

  // ---------- commands ----------
  async function finishGame() {
    reply('Fetching your latest match.', { say: false });
    try {
      const matches = await api.sync();
      const m = matches[0];
      if (!m) throw new Error('no matches');
      if (store.get('lastReviewed') === m.id) { reply('No new game yet. OpenDota can take a few minutes after a match. Try again shortly.'); return; }
      const lo = t0 || (m.t - 1800) * 1000;
      const mine = notes.filter(n => n.ts >= lo);
      store.set('gamenotes:' + m.id, mine);
      store.set('lastReviewed', m.id);
      t0 = null; store.del('gameStart'); store.del('firedReminders'); refreshStatus(); api.onChange?.();
      const lastGame = api.lastGame();
      await answer('Review my last game and connect my notes to the numbers.', {
        kind: 'review', extra: { lastGame, notes: mine }, fallback: () => ruleReview(lastGame, mine),
      });
    } catch (e) { reply('Could not fetch the match: ' + (e.message || e) + '. Try again in a minute.'); }
  }

  async function handle(raw) {
    const cmd = parseCommand(raw);
    if (cmd.type === 'empty') return;
    line('You', raw, 'me');
    if (cmd.type === 'start') { t0 = Date.now(); store.set('gameStart', t0); refreshStatus(); api.onChange?.(); return reply('Game timer started. Say note, then what happened, to log it.', { local: true }); }
    if (cmd.type === 'note-empty') return reply('What should I note? Say note, then your text.', { local: true });
    if (cmd.type === 'note') {
      notes.push({ ts: Date.now(), t: t0 ? (Date.now() - t0) / 1000 : null, text: cmd.text.slice(0, 300) });
      notes = notes.slice(-100); store.set('notes', notes); refreshStatus(); api.onChange?.();
      return reply('Noted.', { local: true });
    }
    if (cmd.type === 'finish') return finishGame();
    if (busy) return reply('One moment, still working on the last question.', { say: false });
    return answer(cmd.text, { fallback: () => ruleAnswer(cmd.text, api.context()) });
  }

  // ---------- passcode ----------
  function showPass(msg) { $('#ask-pass').hidden = false; setStatus(msg); $('#ask-pass-in').focus(); }
  $('#ask-pass').onsubmit = e => {
    e.preventDefault();
    const v = $('#ask-pass-in').value.trim();
    if (!v) return;
    store.set('passcode', v); $('#ask-pass-in').value = ''; $('#ask-pass').hidden = true; setStatus('Passcode saved on this device. Ask your question again.');
  };

  // ---------- voice ----------
  function setOrb(label) { orb.querySelector('span').textContent = label; orb.classList.toggle('on', listening); orb.setAttribute('aria-pressed', String(listening)); }
  function startVoice(continuous) {
    if (!SR) { reply('Voice needs Chrome or Edge on desktop or Android. Typing always works.', { say: false }); return; }
    if (listening) return;
    stopSpeaking();
    rc = new SR();
    rc.lang = 'en-US'; rc.continuous = continuous; rc.interimResults = true;
    let interim;
    rc.onresult = e => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) { if (!speaking) { interim?.remove(); interim = null; handle(r[0].transcript); } } else live += r[0].transcript;
      }
      if (live) { if (!interim) interim = line('You', '', 'me wait'); interim.innerHTML = `<b>You</b> ${esc(live)}…`; }
    };
    rc.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantListen = false; reply('Microphone access was blocked. Allow it in the browser address bar, or type instead.', { say: false }); }
      else if (e.error === 'network') { wantListen = false; reply('Voice recognition could not reach its service. Typing still works.', { say: false }); }
    };
    rc.onend = () => {
      listening = false; setOrb('Hold to talk');
      if (wantListen && $('#ask-hf').checked && !panel.hidden) { try { startVoice(true); } catch { /* ignore */ } }
    };
    try { rc.start(); listening = true; setOrb('Listening'); } catch { listening = false; }
  }
  function stopVoice() { wantListen = false; try { rc && rc.stop(); } catch { /* ignore */ } }

  if (!SR) { orb.disabled = true; $('#ask-hf').disabled = true; $('#ask-hint').textContent = 'Voice needs Chrome or Edge on desktop or Android. Typing works everywhere.'; }
  orb.addEventListener('pointerdown', e => { e.preventDefault(); if ($('#ask-hf').checked) { wantListen = !wantListen; wantListen ? startVoice(true) : stopVoice(); } else startVoice(false); });
  orb.addEventListener('pointerup', () => { if (!$('#ask-hf').checked) stopVoice(); });
  orb.addEventListener('pointerleave', () => { if (!$('#ask-hf').checked && listening) stopVoice(); });
  orb.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); if ($('#ask-hf').checked) { wantListen = !wantListen; wantListen ? startVoice(true) : stopVoice(); } else startVoice(false); } });
  orb.addEventListener('keyup', e => { if ((e.key === ' ' || e.key === 'Enter') && !$('#ask-hf').checked) stopVoice(); });
  $('#ask-hf').onchange = e => { if (!e.target.checked) stopVoice(); setOrb(e.target.checked ? 'Tap to toggle' : 'Hold to talk'); };
  // Hold V (outside text fields) to talk while the panel is open.
  document.addEventListener('keydown', e => {
    if (panel.hidden || e.repeat || e.key.toLowerCase() !== 'v' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || $('#ask-hf').checked) return;
    heldKey = true; startVoice(false);
  });
  document.addEventListener('keyup', e => { if (heldKey && e.key.toLowerCase() === 'v') { heldKey = false; stopVoice(); } });

  // ---------- open / close ----------
  function open() {
    panel.hidden = false; $('#ask-fab').hidden = true;
    if (!log.children.length) {
      line('Astra', 'Ask me about your games, or say "start game", "note …", "game finished". I only use your synced ranked data.');
      $('#ask-chips').innerHTML = SUGGESTIONS.map(s => `<button type="button" class="chip-btn">${esc(s)}</button>`).join('');
    }
    refreshStatus();
    $('#ask-in').focus();
  }
  function close() { stopVoice(); stopSpeaking(); panel.hidden = true; $('#ask-fab').hidden = false; $('#ask-fab').focus(); }
  $('#ask-fab').onclick = open;
  $('#ask-close').onclick = close;
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('#ask-chips').onclick = e => { const b = e.target.closest('.chip-btn'); if (b) handle(b.textContent); };
  $('#ask-form').onsubmit = e => { e.preventDefault(); const v = $('#ask-in').value; $('#ask-in').value = ''; handle(v); };

  // Ask a question on the user's behalf (draft explanation), shown in the panel like a typed question.
  function askAbout(question, opts) { open(); line('You', question, 'me'); return busy ? undefined : answer(question, opts); }
  return { open, close, handle, say: t => reply(t), ask: askAbout, ctx: () => api.context(), hide: () => { root.hidden = true; }, show: () => { root.hidden = false; } };
}
