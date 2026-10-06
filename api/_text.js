// Shared text helpers for the AI functions.
import { clip } from './_guard.js';

export const NOTE_LEN = 300, MAX_NOTES = 20;

// Stop player text from closing our data tags.
export const defang = s => String(s).replace(/<\/?(data|notes|question|said)[^>]*>/gi, '');

/** One note as a line of text, keeping its game time ("12:30 died to a gank"). */
export function noteLine(n) {
  const text = clip(typeof n === 'string' ? n : n && n.text, NOTE_LEN).trim();
  if (!text) return '';
  const s = n && Number.isFinite(n.atGameSeconds) ? n.atGameSeconds : null;
  return (s != null && s >= 0 ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + ' ' : '') + text;
}

/** The notes block shared by both prompts. */
export const notesBlock = notes => (Array.isArray(notes) ? notes : []).slice(-MAX_NOTES).map(noteLine).filter(Boolean).map(n => '- ' + defang(n)).join('\n') || '(none)';
