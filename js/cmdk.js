// Command bar (Ctrl+K, or "/" outside text fields): jump to any page, period or hero, run an action, or ask Astra.
import { esc } from './ui.js';

/**
 * opts.items(): [{ label, hint, kw, run, group }]; opts.ask(text): send free text to Astra.
 */
export function initCmdk({ items, ask }) {
  const root = document.createElement('div');
  root.className = 'cmdk';
  root.hidden = true;
  root.innerHTML = `<div class="cmdk-back" data-close></div><div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Command bar">
<div class="cmdk-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="cmdk-q" placeholder="Jump to a page or hero, run an action, or ask Astra anything" autocomplete="off" spellcheck="false" aria-controls="cmdk-list"><kbd>Esc</kbd></div>
<ul id="cmdk-list" class="cmdk-list" role="listbox"></ul>
<div class="cmdk-foot sm mu"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span>Typing a question sends it to Astra</span></div></div>`;
  document.body.append(root);
  const q = root.querySelector('#cmdk-q'), list = root.querySelector('#cmdk-list');
  let shown = [], sel = 0, lastFocus = null;

  function results(text) {
    const t = text.trim().toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    const all = items();
    const match = it => { const hay = (it.label + ' ' + (it.kw || '') + ' ' + (it.group || '')).toLowerCase(); return words.every(w => hay.includes(w)); };
    let out = t ? all.filter(match) : all.filter(it => it.pinned);
    // Prefer matches at the start of the label.
    out.sort((a, b) => (b.label.toLowerCase().startsWith(t) ? 1 : 0) - (a.label.toLowerCase().startsWith(t) ? 1 : 0));
    out = out.slice(0, 8);
    if (t) {
      const askItem = { label: `Ask Astra: “${text.trim()}”`, hint: 'AI', group: 'Astra', run: () => ask(text.trim()), ask: true };
      const question = /\?$/.test(t) || words.length >= 3 || !out.length;
      out = question ? [askItem, ...out] : [...out, askItem];
    }
    return out;
  }
  function draw() {
    shown = results(q.value);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((it, i) => `<li role="option" id="cmdk-${i}" aria-selected="${i === sel}" class="${it.ask ? 'ask' : ''}" data-i="${i}"><span class="cg">${esc(it.group || '')}</span><span class="cl">${esc(it.label)}</span>${it.hint ? `<span class="ch">${esc(it.hint)}</span>` : ''}</li>`).join('') || '<li class="empty-li mu">Type to search pages, heroes and actions</li>';
    q.setAttribute('aria-activedescendant', shown.length ? 'cmdk-' + sel : '');
    const cur = list.querySelector('[aria-selected=true]');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function open(prefill = '') {
    lastFocus = document.activeElement;
    root.hidden = false; q.value = prefill; sel = 0; draw(); q.focus();
  }
  function close() { root.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function run(i) { const it = shown[i]; if (!it) return; close(); it.run(); }

  q.addEventListener('input', () => { sel = 0; draw(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i)); });
  list.addEventListener('mousemove', e => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== sel) { sel = Number(li.dataset.i); draw(); } });
  root.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) close(); });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && root.hidden)) { e.preventDefault(); root.hidden ? open() : close(); }
  });
  return { open, close };
}
