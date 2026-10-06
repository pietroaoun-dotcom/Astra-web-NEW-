// Conversation rendering shared by the floating panel and the Live page.
import { esc } from './ui.js';

export const SUGGESTIONS = [
  'Enemy has Axe and Lina',
  'What should I pick?',
  'Add Zeus to my favourites',
  'Remember that I struggle against Broodmother',
  'What should I fix first?',
];

const STATUS = { idle: 'Ready', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };
export const statusLabel = s => STATUS[s] || 'Ready';

const time = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
// Keep line breaks, and render "- " lines as a list, without allowing any HTML from the text.
function body(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const l of lines) {
    const m = l.match(/^\s*[-*•]\s+(.*)/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; }
    else { if (inList) { html += '</ul>'; inList = false; } if (l.trim()) html += `<p>${l}</p>`; }
  }
  return html + (inList ? '</ul>' : '');
}

export function convoHtml(st, { suggestions = true } = {}) {
  const msgs = st.messages.map(m => {
    if (m.kind === 'wait') return `<div class="msg astra wait" aria-label="Astra is thinking"><div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div></div>`;
    const acts = m.acts && m.acts.length ? `<ul class="acts">${m.acts.map(a => `<li class="${a.ok ? 'ok' : 'no'}"><span aria-hidden="true">${a.ok ? '✓' : '!'}</span> ${esc(a.label)}</li>`).join('')}</ul>` : '';
    const who = m.who === 'you' ? 'You' : 'Astra';
    return `<div class="msg ${m.who === 'you' ? 'you' : 'astra'}${m.kind ? ' ' + m.kind : ''}"><div class="bubble">${m.text ? body(m.text) : ''}${acts}</div><div class="meta">${who}${m.voice ? ' · voice' : ''}${m.kind === 'reminder' ? ' · reminder' : ''}${m.kind === 'offline' ? ' · without AI' : ''} · ${time(m.ts)}</div></div>`;
  }).join('');
  const interim = st.interim ? `<div class="msg you interim"><div class="bubble"><p>${esc(st.interim)}…</p></div></div>` : '';
  const empty = !st.messages.length && suggestions
    ? `<div class="convo-empty"><p>Talk to me like a teammate. I can fill in the draft, set your preferences, keep notes during the game and remember things about you.</p><div class="chips">${SUGGESTIONS.map(s => `<button type="button" class="chip-btn" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`
    : '';
  return empty + msgs + interim;
}

/** Render into a scroll container, keeping the view pinned to the bottom when it already was. */
export function renderConvo(el, st, opts) {
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.innerHTML = convoHtml(st, opts);
  if (atBottom || st.status === 'thinking' || st.interim) el.scrollTop = el.scrollHeight;
}
