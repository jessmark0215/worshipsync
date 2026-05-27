// ============================================================
// WORSHIPSYNC · js/shared/verse.js
// Verse of the day widget — mountable on any page.
// ============================================================

import { $, esc } from './ui.js';
import { verses, getTodayVerse } from './data.js';

let currentIndex = null; // null = today's verse

function getVerse() {
  if (currentIndex === null) return getTodayVerse();
  return verses[currentIndex % verses.length];
}

export function renderVerseCard() {
  const v = getVerse();
  const today = new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  return `
    <div class="verse-card">
      <p class="verse-label"><i data-lucide="book-open"></i>Verse of the day</p>
      <p class="verse-text">${esc(v.text)}</p>
      <div class="verse-ref">
        <span>— ${esc(v.ref)} · ${esc(today)}</span>
        <button class="verse-refresh" id="verseRefresh" aria-label="Another verse">
          <i data-lucide="refresh-cw"></i>Refresh
        </button>
      </div>
    </div>
  `;
}

export function bindVerseRefresh() {
  const btn = $('#verseRefresh');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = currentIndex === null
      ? verses.indexOf(getTodayVerse())
      : currentIndex;
    currentIndex = (current + 1) % verses.length;
    const verseCard = document.querySelector('.verse-card');
    if (verseCard) {
      verseCard.outerHTML = renderVerseCard();
      if (window.lucide) window.lucide.createIcons();
      bindVerseRefresh();
    }
  });
}
