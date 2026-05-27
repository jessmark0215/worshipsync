// ============================================================
// WORSHIPSYNC · js/shared/search.js
// Live search across events, songs, musicians, notifications.
// ============================================================

import { $, $$, esc } from './ui.js';
import { events, memberDirectory, notifications, isAdmin } from './data.js';

let _dropdown = null;
let _input = null;
let _lastQuery = '';

export function initSearch() {
  _input = $('.search-input');
  if (!_input) return;

  _input.addEventListener('input', onInput);
  _input.addEventListener('focus', () => {
    if (_input.value.trim()) showDropdown();
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (_dropdown && !_dropdown.contains(e.target) && e.target !== _input) {
      hideDropdown();
    }
  });

  // Cmd/Ctrl + K to focus
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      _input.focus();
      _input.select();
    }
    if (e.key === 'Escape' && _dropdown) {
      hideDropdown();
      _input.blur();
    }
  });
}

function onInput() {
  const query = _input.value.trim().toLowerCase();
  if (query === _lastQuery) return;
  _lastQuery = query;
  if (!query) {
    hideDropdown();
    return;
  }
  const results = runSearch(query);
  renderDropdown(results, query);
}

function runSearch(q) {
  const out = {
    events: [],
    songs: [],
    musicians: [],
    notifications: [],
  };

  // Events: title, location
  for (const ev of events) {
    if (ev.title.toLowerCase().includes(q) ||
        (ev.location || '').toLowerCase().includes(q)) {
      out.events.push(ev);
    }
  }

  // Songs (within events): title, artist, key
  for (const ev of events) {
    for (const song of ev.setlist) {
      if (song.title.toLowerCase().includes(q) ||
          (song.artist || '').toLowerCase().includes(q) ||
          (song.key || '').toLowerCase().includes(q)) {
        out.songs.push({ ...song, eventId: ev.id, eventTitle: ev.title });
      }
    }
  }

  // Musicians (directory + team)
  const seenNames = new Set();
  for (const m of memberDirectory) {
    if (m.name.toLowerCase().includes(q) ||
        m.roles.some(r => r.toLowerCase().includes(q))) {
      out.musicians.push(m);
      seenNames.add(m.name);
    }
  }
  // Also include team members in events not in directory
  for (const ev of events) {
    for (const m of ev.team) {
      if (seenNames.has(m.name)) continue;
      if (m.name.toLowerCase().includes(q) ||
          m.role.toLowerCase().includes(q)) {
        out.musicians.push({ name: m.name, initials: m.initials, color: m.color || 'green', roles: [m.role] });
        seenNames.add(m.name);
      }
    }
  }

  // Notifications: text (strip HTML for matching)
  for (const n of notifications) {
    const plain = n.text.replace(/<[^>]+>/g, '').toLowerCase();
    if (plain.includes(q)) {
      out.notifications.push(n);
    }
  }

  // Limit results per category
  out.events = out.events.slice(0, 4);
  out.songs = out.songs.slice(0, 5);
  out.musicians = out.musicians.slice(0, 5);
  out.notifications = out.notifications.slice(0, 4);

  return out;
}

function renderDropdown(results, query) {
  ensureDropdown();
  const totalCount = results.events.length + results.songs.length
    + results.musicians.length + results.notifications.length;

  let html = '';

  if (totalCount === 0) {
    html = `
      <div class="search-empty">
        <i data-lucide="search-x"></i>
        <p>No results for "${esc(query)}"</p>
        <p class="search-empty-sub">Try a song name, musician, or event title.</p>
      </div>
    `;
  } else {
    if (results.events.length) {
      html += renderGroup('Events', 'calendar-check-2', results.events.map(ev => `
        <button class="search-result" data-result-type="event" data-event-id="${ev.id}">
          <div class="search-result-icon" style="background: var(--accent-soft); color: var(--accent);">
            <i data-lucide="calendar"></i>
          </div>
          <div class="search-result-body">
            <p class="search-result-title">${highlight(ev.title, query)}</p>
            <p class="search-result-sub">${esc(formatDate(ev.date))} · ${esc(ev.time)} · ${esc(ev.location)}</p>
          </div>
        </button>
      `).join(''));
    }

    if (results.songs.length) {
      html += renderGroup('Songs', 'music-2', results.songs.map(s => `
        <button class="search-result" data-result-type="song" data-event-id="${s.eventId}" data-song-id="${esc(s.id)}">
          <div class="search-result-icon" style="background: ${s.color}1f; color: ${s.color};">
            <i data-lucide="music"></i>
          </div>
          <div class="search-result-body">
            <p class="search-result-title">${highlight(s.title, query)}</p>
            <p class="search-result-sub">
              ${s.artist ? esc(s.artist) + ' · ' : ''}Key ${esc(s.key)} · in ${esc(s.eventTitle)}
            </p>
          </div>
        </button>
      `).join(''));
    }

    if (results.musicians.length) {
      html += renderGroup('Musicians', 'user-round', results.musicians.map(m => `
        <button class="search-result" data-result-type="musician" data-musician="${esc(m.name)}">
          <div class="avatar avatar-sm ${m.color ? 'avatar-' + m.color : ''}">${esc(m.initials)}</div>
          <div class="search-result-body">
            <p class="search-result-title">${highlight(m.name, query)}</p>
            <p class="search-result-sub">${m.roles.join(' · ')}</p>
          </div>
        </button>
      `).join(''));
    }

    if (results.notifications.length) {
      html += renderGroup('Notifications', 'bell', results.notifications.map(n => `
        <button class="search-result" data-result-type="notification" data-notif-id="${esc(n.id)}" data-event-id="${n.eventId || ''}">
          <div class="search-result-icon" style="background: var(--card-soft); color: var(--text-2);">
            <i data-lucide="${esc(n.icon)}"></i>
          </div>
          <div class="search-result-body">
            <p class="search-result-title">${stripHtmlAndHighlight(n.text, query)}</p>
            <p class="search-result-sub">${esc(n.time)}</p>
          </div>
        </button>
      `).join(''));
    }
  }

  _dropdown.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
  bindResults();
  showDropdown();
}

function renderGroup(label, icon, items) {
  return `
    <div class="search-group">
      <p class="search-group-label">
        <i data-lucide="${icon}"></i>${esc(label)}
      </p>
      ${items}
    </div>
  `;
}

function bindResults() {
  $$('.search-result', _dropdown).forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.resultType;
      const eventId = btn.dataset.eventId;
      const musicianName = btn.dataset.musician;
      hideDropdown();
      _input.value = '';
      _lastQuery = '';

      if (type === 'event' || type === 'song' || type === 'notification') {
        if (eventId) jumpToEvent(parseInt(eventId));
      } else if (type === 'musician') {
        // Admins jump to Members page; everyone else gets no-op
        if (isAdmin() && musicianName) {
          location.href = `admin-members.html#${encodeURIComponent(musicianName)}`;
        }
      }
    });
  });
}

function jumpToEvent(eventId) {
  const onSchedules = location.pathname.endsWith('index.html')
    || location.pathname.endsWith('/')
    || location.pathname === '';

  if (onSchedules) {
    window.dispatchEvent(new CustomEvent('worshipsync:focus-event', {
      detail: { eventId },
    }));
  } else {
    location.href = `index.html#event-${eventId}`;
  }
}

function ensureDropdown() {
  if (_dropdown) return;
  _dropdown = document.createElement('div');
  _dropdown.className = 'search-dropdown';
  _input.closest('.search-wrap').appendChild(_dropdown);
}

function showDropdown() {
  if (!_dropdown) return;
  _dropdown.classList.add('open');
}
function hideDropdown() {
  if (!_dropdown) return;
  _dropdown.classList.remove('open');
}

// Helpers
function highlight(text, q) {
  if (!q) return esc(text);
  const escaped = esc(text);
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return escaped.replace(re, '<mark>$1</mark>');
}

function stripHtmlAndHighlight(html, q) {
  const plain = html.replace(/<[^>]+>/g, '');
  return highlight(plain, q);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
