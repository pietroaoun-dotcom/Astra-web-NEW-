// Floating "Ask Astra" panel: a compact view of the shared conversation, available on every page except Live.
import { renderConvo, statusLabel } from './convo.js';

export function initAskPanel(assistant) {
  const root = document.createElement('div');
  root.innerHTML = `
<button id="ask-fab" class="pri" aria-haspopup="dialog" aria-controls="ask">
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z" fill="#fff"/></svg> Ask Astra</button>
<aside id="ask" role="dialog" aria-label="Ask Astra" hidden>
  <header><div><b>Ask Astra</b> <span class="status-pill" id="ask-status"></span></div>
    <div class="row" style="gap:6px"><a href="#/live" class="ghost btn-link" id="ask-full">Full screen</a><button class="ghost" id="ask-close" aria-label="Close">Close</button></div></header>
  <div id="ask-log" class="convo" aria-live="polite"></div>
  <p id="ask-notice" class="mu sm" aria-live="polite"></p>
  <form id="ask-pass" class="row" hidden>
    <input type="password" id="ask-pass-in" class="grow" placeholder="Passcode" autocomplete="current-password" aria-label="Astra passcode">
    <button class="pri">Unlock</button></form>
  <div class="talkbar">
    <button id="ask-orb" class="orb sm" type="button" aria-label="Hold to talk"><i></i><span>Hold</span></button>
    <form id="ask-form" class="row grow"><input id="ask-in" class="grow" maxlength="500" placeholder="Say or type anything…" aria-label="Message Astra" autocomplete="off"><button class="pri">Send</button></form>
  </div>
  <div class="row sm mu toggles">
    <label class="switch"><input type="checkbox" id="ask-conv"><span></span> Conversation mode</label>
    <label class="switch"><input type="checkbox" id="ask-tts"><span></span> Speak replies</label>
    <span class="grow"></span><span>Hold <kbd>V</kbd> to talk</span>
  </div>
</aside>`;
  document.body.append(root);
  const $ = s => root.querySelector(s);
  const panel = $('#ask'), log = $('#ask-log'), orb = $('#ask-orb');

  function draw(st) {
    if (panel.hidden) return;
    renderConvo(log, st);
    $('#ask-status').textContent = statusLabel(st.status);
    $('#ask-status').dataset.s = st.status;
    orb.classList.toggle('on', st.status === 'listening');
    orb.querySelector('span').textContent = st.conversation ? (st.status === 'listening' ? 'On' : 'Live') : 'Hold';
    $('#ask-pass').hidden = !st.needPass;
    $('#ask-notice').textContent = st.notice || (st.needPass ? 'Enter your passcode to unlock the AI. Commands still work without it.' : '');
    $('#ask-conv').checked = st.conversation;
    $('#ask-tts').checked = st.tts;
    orb.disabled = !st.voiceSupported;
    $('#ask-conv').disabled = !st.voiceSupported;
  }
  assistant.subscribe(draw);

  function open() { panel.hidden = false; $('#ask-fab').hidden = true; draw(assistant.state); log.scrollTop = log.scrollHeight; $('#ask-in').focus(); }
  function close() { panel.hidden = true; $('#ask-fab').hidden = false; $('#ask-fab').focus(); }
  $('#ask-fab').onclick = open;
  $('#ask-close').onclick = close;
  $('#ask-full').onclick = () => { panel.hidden = true; };
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  log.addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) assistant.send(b.dataset.say); });
  $('#ask-form').onsubmit = e => { e.preventDefault(); const v = $('#ask-in').value; $('#ask-in').value = ''; assistant.send(v); };
  $('#ask-pass').onsubmit = e => { e.preventDefault(); const v = $('#ask-pass-in').value.trim(); if (v) { assistant.setPasscode(v); $('#ask-pass-in').value = ''; } };
  $('#ask-conv').onchange = e => assistant.setConversation(e.target.checked);
  $('#ask-tts').onchange = e => assistant.setTts(e.target.checked);
  bindHoldToTalk(orb, assistant);

  return {
    open, close,
    setVisible(v) {
      root.hidden = !v;
      if (!v) { panel.hidden = true; $('#ask-fab').hidden = false; }
    },
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
