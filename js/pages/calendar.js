// ============================================================
// WORSHIPSYNC · js/pages/calendar.js
// Calendar of events — read-only view of the full church calendar.
// Month / Week / List views, filter chips by event type, click-a-day
// to expand the day's events inline.
// ============================================================

import { $, $$, esc } from '../shared/ui.js';
import {
  currentUser, events, parseLocalDate, onDataChange,
} from '../shared/data.js';
import { initShell } from '../shared/shell.js';

// ============================================================
// EVENT CATEGORIZATION
// ============================================================
// The events collection doesn't carry a category field, so we infer one
// from the event's metadata. Used for color coding and filter chips.
//   sunday-service — recurring event landing on a Sunday (or "service" in title)
//   rehearsal      — title contains "rehearsal"/"practice"
//   special        — any other one-off event
//   other          — fallback bucket; should be rare
const CATEGORY_META = {
  'sunday-service': { label: 'Sunday service', dot: 'cat-purple', icon: 'church'    },
  'rehearsal':      { label: 'Rehearsal',      dot: 'cat-amber',  icon: 'music-2'   },
  'special':        { label: 'Special event',  dot: 'cat-teal',   icon: 'sparkles'  },
  'other':          { label: 'Other',          dot: 'cat-blue',   icon: 'calendar'  },
};

function categoryOf(ev) {
  // Virtual rehearsal entries (generated from event.rehearsalDate) are always
  // rehearsals, regardless of the parent event's title or recurrence.
  if (ev._isRehearsal) return 'rehearsal';

  const title = (ev.title || '').toLowerCase();
  if (title.includes('rehears') || title.includes('practice')) return 'rehearsal';
  // recurring event on a Sunday OR any event whose title says "service"
  const d = parseLocalDate(ev.date);
  if (d && d.getDay() === 0 && ev.recurring) return 'sunday-service';
  if (title.includes('service') || title.includes('worship')) return 'sunday-service';
  if (!ev.recurring) return 'special';
  return 'other';
}

// ============================================================
// LOCAL UI STATE
// ============================================================
const ui = {
  view: 'month',           // 'month' | 'week' | 'list'
  cursor: startOfMonth(new Date()), // anchor date for the current view
  filter: 'all',           // 'all' | 'sunday-service' | 'rehearsal' | 'special'
  selectedDay: null,       // YYYY-MM-DD string when a day cell is expanded
};

// ============================================================
// DATE HELPERS
// ============================================================
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function startOfWeek(d) {
  // Sunday-first weeks (matches the WEEKDAYS array above)
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}
function isoDate(d) {
  // YYYY-MM-DD in local time (matches the event.date format)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}
function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// ============================================================
// EVENT LOOKUP
// ============================================================
// Build a map of date-string -> entries on that date (filtered).
// Recomputed every render so it stays in sync with live updates.
//
// Each event can produce up to TWO entries on the calendar:
//   1. The event itself, on event.date
//   2. A "virtual" rehearsal entry, on event.rehearsalDate (if set)
// The rehearsal entry is the same object shape as the event but tagged
// with `_isRehearsal: true` so renderers can label it and color it amber.
function buildEventsByDate() {
  const map = new Map();
  const push = (iso, entry) => {
    if (!iso) return;
    if (ui.filter !== 'all' && categoryOf(entry) !== ui.filter) return;
    const list = map.get(iso) || [];
    list.push(entry);
    map.set(iso, list);
  };

  for (const ev of events) {
    // Main event
    push(ev.date, ev);

    // Rehearsal — derive a date if the event has a structured rehearsalDate.
    // We don't try to parse the legacy free-text `rehearsal` string here; if
    // an event was created before structured rehearsals, the admin can re-save
    // it once and the rehearsalDate will populate.
    if (ev.rehearsalDate && ev.rehearsalDate !== ev.date) {
      push(ev.rehearsalDate, {
        ...ev,
        _isRehearsal: true,
        // Use the rehearsal's time slot, not the event's main time
        time: ev.rehearsalTime || '',
      });
    }
  }

  // Sort within each day by time
  for (const list of map.values()) {
    list.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  }
  return map;
}

function timeToMinutes(t) {
  if (!t) return 0;
  // Accepts "5:00 PM", "5:00PM", "17:00"
  const s = t.trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2}):(\d{2})(AM|PM)?$/);
  if (!m) return 0;
  let hr = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3];
  if (ampm === 'PM' && hr !== 12) hr += 12;
  if (ampm === 'AM' && hr === 12) hr = 0;
  return hr * 60 + min;
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const root = $('#page');
  root.innerHTML = `
    <div class="page-head">
      <h1 class="page-greeting">Calendar of events</h1>
      <p class="page-sub">Every service, rehearsal, and special event across the church — at a glance.</p>
    </div>

    ${renderToolbar()}
    ${renderFilters()}
    ${renderView()}
  `;
  bindAll();
  if (window.lucide) window.lucide.createIcons();
}

function renderToolbar() {
  // Title text depends on the active view
  let label = '';
  if (ui.view === 'month') {
    label = `${MONTHS[ui.cursor.getMonth()]} ${ui.cursor.getFullYear()}`;
  } else if (ui.view === 'week') {
    const start = startOfWeek(ui.cursor);
    const end = addDays(start, 6);
    if (sameMonth(start, end)) {
      label = `${MONTHS[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    } else {
      const startStr = `${MONTHS[start.getMonth()].slice(0,3)} ${start.getDate()}`;
      const endStr = `${MONTHS[end.getMonth()].slice(0,3)} ${end.getDate()}`;
      label = `${startStr} – ${endStr}, ${end.getFullYear()}`;
    }
  } else {
    label = `${MONTHS[ui.cursor.getMonth()]} ${ui.cursor.getFullYear()}`;
  }

  return `
    <div class="cal-toolbar">
      <div class="cal-toolbar-nav">
        <button class="icon-btn cal-nav-btn" id="navPrev" aria-label="Previous">
          <i data-lucide="chevron-left"></i>
        </button>
        <h2 class="cal-title">${esc(label)}</h2>
        <button class="icon-btn cal-nav-btn" id="navNext" aria-label="Next">
          <i data-lucide="chevron-right"></i>
        </button>
        <button class="btn btn-light btn-sm cal-today-btn" id="navToday">
          <i data-lucide="circle-dot"></i>Today
        </button>
      </div>

      <div class="cal-view-switch" role="tablist" aria-label="View">
        ${['month', 'week', 'list'].map(v => `
          <button class="cal-view-btn ${ui.view === v ? 'is-active' : ''}"
                  role="tab"
                  data-view="${v}"
                  aria-selected="${ui.view === v}">
            ${v[0].toUpperCase()}${v.slice(1)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderFilters() {
  const chips = [
    { id: 'all',             label: 'All events',      icon: 'layers' },
    { id: 'sunday-service',  label: 'Sunday services', icon: 'church' },
    { id: 'rehearsal',       label: 'Rehearsals',      icon: 'music-2' },
    { id: 'special',         label: 'Special events',  icon: 'sparkles' },
  ];
  return `
    <div class="cal-filters">
      ${chips.map(c => `
        <button class="cal-filter-chip ${ui.filter === c.id ? 'is-active' : ''}" data-filter="${c.id}">
          <i data-lucide="${c.icon}"></i>${esc(c.label)}
        </button>
      `).join('')}

      <div class="cal-legend" aria-hidden="true">
        ${Object.entries(CATEGORY_META).filter(([id]) => id !== 'other').map(([id, m]) => `
          <span class="cal-legend-item">
            <span class="cal-dot ${m.dot}"></span>${esc(m.label)}
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

function renderView() {
  if (ui.view === 'month') return renderMonth();
  if (ui.view === 'week') return renderWeek();
  return renderList();
}

// ----- Month view -----
function renderMonth() {
  const byDate = buildEventsByDate();
  const monthStart = startOfMonth(ui.cursor);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = startOfWeek(monthStart);
  const totalCells = Math.ceil((monthEnd.getDate() + monthStart.getDay()) / 7) * 7;
  const today = new Date();

  let cellsHtml = '';
  for (let i = 0; i < totalCells; i++) {
    const cellDate = addDays(gridStart, i);
    const iso = isoDate(cellDate);
    const dayEvents = byDate.get(iso) || [];
    const inMonth = sameMonth(cellDate, monthStart);
    const isToday = sameDay(cellDate, today);
    const isSelected = ui.selectedDay === iso;
    const isSun = cellDate.getDay() === 0;

    const classes = [
      'cal-cell',
      inMonth ? '' : 'is-faded',
      isToday ? 'is-today' : '',
      isSelected ? 'is-selected' : '',
      isSun ? 'is-sunday' : '',
      dayEvents.length > 0 ? 'has-events' : '',
    ].filter(Boolean).join(' ');

    // Up to three dots, then a "+N" marker
    const maxDots = 3;
    const dotsHtml = dayEvents.slice(0, maxDots).map(ev => {
      const cat = categoryOf(ev);
      const meta = CATEGORY_META[cat];
      return `<span class="cal-dot ${meta.dot}" title="${esc(ev.title)}"></span>`;
    }).join('');
    const overflow = dayEvents.length > maxDots
      ? `<span class="cal-overflow">+${dayEvents.length - maxDots}</span>`
      : '';

    cellsHtml += `
      <button class="${classes}" data-cell-date="${iso}" ${dayEvents.length === 0 ? 'tabindex="-1"' : ''}>
        <span class="cal-cell-num">${cellDate.getDate()}</span>
        ${dayEvents.length > 0 ? `<span class="cal-cell-dots">${dotsHtml}${overflow}</span>` : ''}
      </button>
    `;
  }

  const headerHtml = WEEKDAYS.map((w, i) => `
    <div class="cal-weekday ${i === 0 ? 'is-sunday' : ''}">${w}</div>
  `).join('');

  // Detail panel for the selected day (if any)
  let detailHtml = '';
  if (ui.selectedDay) {
    const dayEvents = byDate.get(ui.selectedDay) || [];
    const d = parseLocalDate(ui.selectedDay);
    detailHtml = renderDayDetail(d, dayEvents);
  }

  return `
    <div class="cal-month-wrap">
      <div class="cal-month-grid">
        <div class="cal-weekday-row">${headerHtml}</div>
        <div class="cal-cells">${cellsHtml}</div>
      </div>
      ${detailHtml}
    </div>
  `;
}

// ----- Week view -----
function renderWeek() {
  const byDate = buildEventsByDate();
  const start = startOfWeek(ui.cursor);
  const today = new Date();

  const cols = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const iso = isoDate(date);
    const dayEvents = byDate.get(iso) || [];
    const isToday = sameDay(date, today);
    const isSun = date.getDay() === 0;

    cols.push(`
      <div class="cal-week-col ${isToday ? 'is-today' : ''} ${isSun ? 'is-sunday' : ''}">
        <div class="cal-week-col-head">
          <span class="cal-week-weekday">${WEEKDAYS[date.getDay()]}</span>
          <span class="cal-week-daynum">${date.getDate()}</span>
        </div>
        <div class="cal-week-col-body">
          ${dayEvents.length === 0
            ? `<p class="cal-week-empty">—</p>`
            : dayEvents.map(ev => renderEventChip(ev)).join('')
          }
        </div>
      </div>
    `);
  }

  return `<div class="cal-week-grid">${cols.join('')}</div>`;
}

// ----- List view -----
function renderList() {
  // List view shows the current month's events grouped by date (in chronological
  // order). It's the most accessible view for screen readers and small phones.
  const byDate = buildEventsByDate();
  const monthStart = startOfMonth(ui.cursor);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);

  const days = [];
  for (let d = new Date(monthStart); d <= monthEnd; d = addDays(d, 1)) {
    const iso = isoDate(d);
    const dayEvents = byDate.get(iso) || [];
    if (dayEvents.length === 0) continue;
    days.push({ date: new Date(d), iso, events: dayEvents });
  }

  if (days.length === 0) {
    return `
      <div class="cal-empty">
        <div class="cal-empty-icon"><i data-lucide="calendar-off"></i></div>
        <h3>Nothing scheduled this month</h3>
        <p>${ui.filter === 'all' ? 'No events on the calendar yet.' : 'Try a different filter.'}</p>
      </div>
    `;
  }

  const today = new Date();
  return `
    <div class="cal-list">
      ${days.map(({ date, iso, events: evs }) => `
        <div class="cal-list-day ${sameDay(date, today) ? 'is-today' : ''}">
          <div class="cal-list-day-head">
            <div class="cal-list-day-num">${date.getDate()}</div>
            <div class="cal-list-day-meta">
              <p class="cal-list-day-weekday">${WEEKDAYS_FULL[date.getDay()]}</p>
              <p class="cal-list-day-month">${MONTHS[date.getMonth()]} ${date.getFullYear()}</p>
            </div>
          </div>
          <div class="cal-list-day-body">
            ${evs.map(ev => renderEventRow(ev)).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ----- Reusable bits -----
function renderEventChip(ev) {
  const cat = categoryOf(ev);
  const meta = CATEGORY_META[cat];
  const titleText = ev._isRehearsal
    ? `Rehearsal: ${ev.title}`
    : ev.title;
  return `
    <div class="cal-event-chip ${meta.dot}" title="${esc(titleText)} · ${esc(ev.time || '')}">
      <span class="cal-event-chip-time">${esc(ev.time || '')}</span>
      <span class="cal-event-chip-title">${esc(titleText)}</span>
    </div>
  `;
}

function renderEventRow(ev) {
  const cat = categoryOf(ev);
  const meta = CATEGORY_META[cat];
  const teamCount = (ev.team || []).length;
  const setlistCount = (ev.setlist || []).length;
  const titleText = ev._isRehearsal
    ? `Rehearsal: ${ev.title}`
    : ev.title;
  return `
    <div class="cal-event-row ${ev._isRehearsal ? 'is-rehearsal' : ''}">
      <span class="cal-dot ${meta.dot}"></span>
      <div class="cal-event-row-body">
        <div class="cal-event-row-title-line">
          <p class="cal-event-row-title">${esc(titleText)}</p>
          <span class="pill pill-${cat === 'sunday-service' ? 'accent' : cat === 'rehearsal' ? 'amber' : cat === 'special' ? 'rose' : 'accent'} cal-event-row-cat">
            <i data-lucide="${meta.icon}"></i>${esc(meta.label)}
          </span>
          ${ev.recurring && !ev._isRehearsal ? `<span class="cal-event-row-recurring" title="Recurring"><i data-lucide="repeat"></i></span>` : ''}
        </div>
        <div class="cal-event-row-meta">
          <span><i data-lucide="clock"></i>${esc(ev.time || '—')}</span>
          <span><i data-lucide="map-pin"></i>${esc(ev.location || '—')}</span>
          ${ev._isRehearsal ? '' : `<span><i data-lucide="users"></i>${teamCount} on team</span>`}
          ${ev._isRehearsal ? '' : `<span><i data-lucide="music-2"></i>${setlistCount} song${setlistCount === 1 ? '' : 's'}</span>`}
        </div>
      </div>
    </div>
  `;
}

function renderDayDetail(date, dayEvents) {
  const dateLabel = `${WEEKDAYS_FULL[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return `
    <div class="cal-day-detail" id="dayDetail">
      <div class="cal-day-detail-head">
        <div>
          <h3 class="cal-day-detail-title">${esc(dateLabel)}</h3>
          <p class="cal-day-detail-sub">
            ${dayEvents.length === 0
              ? 'No events scheduled.'
              : `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'} scheduled`
            }
          </p>
        </div>
        <button class="icon-btn" id="closeDayDetail" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      ${dayEvents.length === 0
        ? `<p class="cal-day-detail-empty">Nothing on the calendar for this day.</p>`
        : `<div class="cal-day-detail-list">${dayEvents.map(renderEventRow).join('')}</div>`
      }
    </div>
  `;
}

// ============================================================
// BINDINGS
// ============================================================
function bindAll() {
  // Prev / Next / Today
  $('#navPrev')?.addEventListener('click', () => {
    if (ui.view === 'week') ui.cursor = addDays(ui.cursor, -7);
    else ui.cursor = addMonths(ui.cursor, -1);
    ui.selectedDay = null;
    render();
  });
  $('#navNext')?.addEventListener('click', () => {
    if (ui.view === 'week') ui.cursor = addDays(ui.cursor, 7);
    else ui.cursor = addMonths(ui.cursor, 1);
    ui.selectedDay = null;
    render();
  });
  $('#navToday')?.addEventListener('click', () => {
    const now = new Date();
    ui.cursor = ui.view === 'week' ? now : startOfMonth(now);
    ui.selectedDay = isoDate(now);
    render();
  });

  // View switch (Month / Week / List)
  $$('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.view = btn.dataset.view;
      ui.selectedDay = null;
      render();
    });
  });

  // Filter chips
  $$('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.filter = btn.dataset.filter;
      render();
    });
  });

  // Month-view day cells (only those with events are interactive)
  $$('[data-cell-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      if (!cell.classList.contains('has-events')) return;
      const iso = cell.dataset.cellDate;
      ui.selectedDay = ui.selectedDay === iso ? null : iso;
      render();
      // Scroll the detail panel into view on small screens
      requestAnimationFrame(() => {
        const detail = $('#dayDetail');
        if (detail && window.innerWidth < 900) {
          detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  });

  // Close-button on the day-detail panel
  $('#closeDayDetail')?.addEventListener('click', () => {
    ui.selectedDay = null;
    render();
  });
}

// Keyboard nav is bound ONCE at boot (not on every render). Re-binding on
// every render would stack listeners and fire the handler multiple times
// per keystroke.
function handleKeydown(e) {
  // Only act on plain key presses (no modifier) and when the user isn't
  // typing into an input — this is a read-only page so input focus is rare,
  // but the topbar search is global.
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

  if (e.key === 'Escape' && ui.selectedDay) {
    ui.selectedDay = null;
    render();
    e.preventDefault();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (ui.view === 'week') ui.cursor = addDays(ui.cursor, dir * 7);
    else ui.cursor = addMonths(ui.cursor, dir);
    ui.selectedDay = null;
    render();
    e.preventDefault();
  }
}

// ============================================================
// BOOT
// ============================================================
(async () => {
  await initShell();
  render();

  // Keyboard shortcuts: arrow keys to step through periods, Esc to close
  // the day-detail panel. Bound once at boot — never inside render/bindAll.
  window.addEventListener('keydown', handleKeydown);

  // Live updates: re-render when events change (admin adds/edits/deletes,
  // or a teammate accepts/declines on another device). The day-detail panel
  // stays open across re-renders because it's part of ui state.
  onDataChange(() => render());
})();
