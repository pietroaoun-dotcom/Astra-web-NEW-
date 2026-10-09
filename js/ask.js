// The Astra dock: always at the bottom of the screen (except on Live, which has the full conversation).
// Type or hold the orb to talk; the conversation opens in a sheet above the dock.
import { renderConvo, statusLabel } from './convo.js';

export function initAskPanel(assistant) {
  const root = document.createElement('div');
  root.className = 'dock-wrap';
  root.innerHTML = `
<section id="ask" class="dock-sheet" aria-label="Conversation with Astra" hidden>
  <header><div class="row" style="gap:10px"><span class="dock-mark" aria-hidden="true"></span><b>Astra</b><span class="status-pill" id="ask-status"></span></div>
    <div class="row" style="gap:6px"><a href="#/live" class="ghost btn-link" id="ask-full">Full screen</a><button class="ghost" id="ask-close" aria-label="Close conversation">Close</button></div></header>
  <div id="ask-log" class="convo" aria-live="polite"></div>
  <p id="ask-notice" class="mu sm" aria-live="polite"></p>
  <form id="ask-pass" class="row" hidden>
    <input type="password" id="ask-pass-in" class="grow" placeholder="Passcode" autocomplete="current-password" aria-label="Astra passcode">
    <button class="pri">Unlock</button></form>
  <div class="row sm mu toggles">
    <label class="switch"><input type="checkbox" id="ask-conv"><span></span> Conversation mode</label>
    <label class="switch"><input type="checkbox" id="ask-tts"><span></span> Speak replies</label>
    <span class="grow"></span><button type="button" class="ghost" id="ask-clear">Clear</button>
  </div>
</section>
<div id="dock" class="dock" role="region" aria-label="Astra">
  <button id="ask-orb" class="orb xs" type="button" aria-label="Hold to talk to Astra"><i></i></button>
  <form id="ask-form" class="dock-form"><input id="ask-in" maxlength="500" placeholder="Ask Astra or give a command…" aria-label="Message Astra" autocomplete="off"></form>
  <span class="dock-hint sm mu" id="dock-hint">Hold <kbd>V</kbd> to talk</span>
  <button type="button" id="ask-fab" class="dock-x" aria-haspopup="dialog" aria-controls="ask" aria-label="Show the conversation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
</div>`;
  document.body.append(root);
  const $ = s => root.querySelector(s);
  const panel = $('#ask'), log = $('#ask-log'), orb = $('#ask-orb'), dock = $('#dock');

  function draw(st) {
    dock.dataset.s = st.status;
    orb.classList.toggle('on', st.status === 'listening');
    orb.classList.toggle('speaking', st.status === 'speaking');
    orb.disabled = !st.voiceSupported;
    $('#dock-hint').textContent = st.status === 'idle' ? (st.conversation ? 'Conversation mode: just talk' : 'Hold V or the orb to talk') : statusLabel(st.status);
    if (panel.hidden) return;
    renderConvo(log, st);
    $('#ask-status').textContent = statusLabel(st.status);
    $('#ask-status').dataset.s = st.status;
    $('#ask-pass').hidden = !st.needPass;
    $('#ask-notice').textContent = st.notice || (st.needPass ? 'This Astra is locked: enter the passcode.' : '');
    $('#ask-conv').checked = st.conversation;
    $('#ask-tts').checked = st.tts;
    $('#ask-conv').disabled = !st.voiceSupported;
  }
  assistant.subscribe(st => {
    // A new message opens the conversation so the reply is visible.
    if (panel.hidden && !root.hidden && st.messages.length && st.messages[st.messages.length - 1].id !== lastSeen) { lastSeen = st.messages[st.messages.length - 1].id; if (st.messages[st.messages.length - 1].who === 'you') open(false); }
    draw(st);
  });
  let lastSeen = (assistant.state.messages[assistant.state.messages.length - 1] || {}).id;

  function open(focus = true) {
    panel.hidden = false; root.classList.add('open'); $('#ask-fab').setAttribute('aria-expanded', 'true');
    draw(assistant.state); log.scrollTop = log.scrollHeight;
    if (focus) $('#ask-in').focus();
  }
  function close() { panel.hidden = true; root.classList.remove('open'); $('#ask-fab').setAttribute('aria-expanded', 'false'); }
  $('#ask-fab').onclick = () => (panel.hidden ? open() : close());
  $('#ask-close').onclick = close;
  $('#ask-full').onclick = close;
  $('#ask-clear').onclick = () => assistant.clear();
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  log.addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) assistant.send(b.dataset.say); });
  $('#ask-form').onsubmit = e => { e.preventDefault(); const v = $('#ask-in').value; $('#ask-in').value = ''; if (v.trim()) { open(false); assistant.send(v); } };
  $('#ask-pass').onsubmit = e => { e.preventDefault(); const v = $('#ask-pass-in').value.trim(); if (v) { assistant.setPasscode(v); $('#ask-pass-in').value = ''; } };
  $('#ask-conv').onchange = e => assistant.setConversation(e.target.checked);
  $('#ask-tts').onchange = e => assistant.setTts(e.target.checked);
  bindHoldToTalk(orb, assistant);
  draw(assistant.state);

  return {
    open, close,
    setVisible(v) { root.hidden = !v; document.body.classList.toggle('has-dock', !!v); if (!v) close(); },
  };
}

/** Hold-to-talk on a button (mouse, touch, Space/Enter). In conversation mode a press toggles it off. */
export function bindHoldToTalk(btn, assistant) {
  const start = e => {
    e.preventDefault();
    if (assistant.state.conversation) { assistant.setConversation(false); return; }
    assistant.holdStart();
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', () => assistant.holdEnd());
  btn.addEventListener('pointerleave', () => { if (assistant.state.status === 'listening') assistant.holdEnd(); });
  btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') assistant.holdEnd(); });
}

/** Global hold-V to talk, outside text fields. */
export function bindHoldKey(assistant) {
  let held = false;
  document.addEventListener('keydown', e => {
    if (e.repeat || e.key.toLowerCase() !== 'v' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
    if (assistant.state.conversation) return;
    held = true; assistant.holdStart();
  });
  document.addEventListener('keyup', e => { if (held && e.key.toLowerCase() === 'v') { held = false; assistant.holdEnd(); } });
}
