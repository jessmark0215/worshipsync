// ============================================================
// WORSHIPSYNC · js/pages/admin-events.js
// Admin Events — manage recurring templates, one-off events, archive.
// ============================================================

import { $, $$, esc, showToast, openModal, closeModal } from '../shared/ui.js';
import {
  currentUser, accounts, isAdmin,
  events, templates,
  categorizeEvents, addOneOffEvent, updateEvent, deleteEvent, archiveEvent,
  addTemplate, updateTemplate, deleteTemplate, generateFromTemplate, nextOccurrences,
  weekdayName, onDataChange,
} from '../shared/data.js';
import { initShell } from '../shared/shell.js';

// ============================================================
// LOCAL UI STATE
// ============================================================
const ui = {
  tab: 'upcoming', // upcoming | recurring | past | cold
};

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ============================================================
// RENDER
// ============================================================
function render() {
  const root = $('#page');

  if (!isAdmin()) {
    root.innerHTML = `
      <div class="admin-gate">
        <div class="admin-gate-icon"><i data-lucide="shield-alert"></i></div>
        <h2>Admin access required</h2>
        <p>This area is for administrators only.</p>
        <a class="btn btn-primary" href="index.html">
          <i data-lucide="arrow-left"></i>Back to my schedules
        </a>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const { upcoming, recentPast, cold } = categorizeEvents();

  root.innerHTML = `
    <div class="admin-head">
      <div>
        <h1 class="admin-head-title">Events</h1>
        <p class="admin-head-sub">Manage recurring services, one-off events, and historical data.</p>
      </div>
      <div class="admin-head-actions">
        <button class="btn btn-light btn-sm" id="addTemplateBtn">
          <i data-lucide="repeat"></i>New recurring
        </button>
        <button class="btn btn-primary btn-sm" id="addOneOffBtn">
          <i data-lucide="calendar-plus"></i>New event
        </button>
      </div>
    </div>

    <div class="events-tabs">
      ${tab('upcoming',  'Upcoming',          'calendar-days',  upcoming.length)}
      ${tab('recurring', 'Recurring',         'repeat',         templates.length)}
      ${tab('past',      'Past',              'history',        recentPast.length)}
      ${tab('cold',      'Cold storage',      'archive',        cold.length)}
    </div>

    <div id="tabContent"></div>
  `;

  renderTab();
  bindToolbar();
  if (window.lucide) window.lucide.createIcons();
}

function tab(id, label, icon, count) {
  const active = ui.tab === id;
  return `
    <button class="event-tab ${active ? 'active' : ''}" data-tab="${id}">
      <i data-lucide="${icon}"></i>
      ${esc(label)}
      <span class="tab-count">${count}</span>
    </button>
  `;
}

function renderTab() {
  const target = $('#tabContent');
  const { upcoming, recentPast, cold } = categorizeEvents();

  let html = '';
  if (ui.tab === 'upcoming') {
    html = renderEventList(upcoming, 'upcoming');
  } else if (ui.tab === 'recurring') {
    html = renderTemplates();
  } else if (ui.tab === 'past') {
    html = `
      <div class="retention-banner">
        <div class="retention-banner-icon"><i data-lucide="info"></i></div>
        <div class="retention-banner-text">
          <p class="retention-banner-title">Retention policy</p>
          <p class="retention-banner-sub">Past events stay here for 3 months, then move to cold storage. After 6 months total they're auto-deleted.</p>
        </div>
      </div>
      ${renderEventList(recentPast, 'past')}
    `;
  } else if (ui.tab === 'cold') {
    html = `
      <div class="retention-banner cold-banner">
        <div class="retention-banner-icon"><i data-lucide="archive"></i></div>
        <div class="retention-banner-text">
          <p class="retention-banner-title">Cold storage</p>
          <p class="retention-banner-sub">Events older than 3 months. Hidden from normal views. Will auto-delete after 6 months — admin will be warned 7 days before.</p>
        </div>
      </div>
      ${renderEventList(cold, 'cold')}
    `;
  }
  target.innerHTML = html;
  bindList();
  if (window.lucide) window.lucide.createIcons();
}

function renderEventList(list, variant) {
  if (list.length === 0) {
    const messages = {
      upcoming: { icon: 'calendar', text: 'No upcoming events. Create a new one or generate from a recurring template.' },
      past:     { icon: 'history',  text: 'No past events in the last 3 months.' },
      cold:     { icon: 'archive',  text: 'Cold storage is empty.' },
    };
    const m = messages[variant];
    return `
      <div class="events-empty">
        <div class="events-empty-icon"><i data-lucide="${m.icon}"></i></div>
        <p>${esc(m.text)}</p>
        ${variant === 'upcoming' ? `<button class="btn btn-primary" id="emptyAddBtn"><i data-lucide="plus"></i>New event</button>` : ''}
      </div>
    `;
  }
  return list.map(ev => renderEventCard(ev, variant)).join('');
}

function renderEventCard(ev, variant) {
  const d = new Date(ev.date);
  const month = d.toLocaleString('en', { month: 'short' });
  const day = d.getDate();
  const weekday = d.toLocaleString('en', { weekday: 'long' });

  // Count team statuses (in this prototype we only have one `status` per event from current user;
  // for admin view, we approximate counts by team size for now)
  const team = ev.team || [];
  const accepted = team.filter(t => t.status === 'accepted').length;
  const pending = team.filter(t => t.status === 'pending').length;
  const declined = team.filter(t => t.status === 'declined').length;

  const cardClass = variant === 'past' ? 'event-admin-card past' : variant === 'cold' ? 'event-admin-card cold' : 'event-admin-card';

  return `
    <div class="${cardClass}" data-event-id="${ev.id}">
      <div class="event-admin-date">
        <div class="event-admin-month">${month}</div>
        <div class="event-admin-day">${day}</div>
      </div>
      <div class="event-admin-info">
        <div class="event-admin-title-row">
          <h3 class="event-admin-title">${esc(ev.title)}</h3>
          ${ev.recurring
            ? '<span class="recurring-badge"><i data-lucide="repeat"></i>Recurring</span>'
            : '<span class="oneoff-badge"><i data-lucide="sparkles"></i>One-off</span>'
          }
        </div>
        <div class="event-admin-meta">
          <span class="event-admin-meta-item"><i data-lucide="calendar"></i>${esc(weekday)}</span>
          <span class="event-admin-meta-item"><i data-lucide="clock"></i>${esc(ev.time || '—')}</span>
          <span class="event-admin-meta-item"><i data-lucide="map-pin"></i>${esc(ev.location || '—')}</span>
          <span class="event-admin-meta-item"><i data-lucide="users"></i>${team.length} assigned</span>
          <span class="event-admin-meta-item"><i data-lucide="music-2"></i>${(ev.setlist || []).length} songs</span>
        </div>
      </div>

      ${variant === 'upcoming' ? `
        <div class="event-status-summary">
          ${pending > 0 ? `<span class="status-pill pending"><i data-lucide="clock"></i>${pending} pending</span>` : ''}
          ${accepted > 0 ? `<span class="status-pill accepted"><i data-lucide="check"></i>${accepted} accepted</span>` : ''}
          ${declined > 0 ? `<span class="status-pill declined"><i data-lucide="x"></i>${declined} declined</span>` : ''}
        </div>
      ` : ''}

      <div class="event-admin-actions">
        ${variant === 'upcoming' ? `
          <button class="member-action-btn" data-edit-event="${ev.id}" title="Edit">
            <i data-lucide="pen-line"></i>
          </button>
          <button class="member-action-btn" data-archive-event="${ev.id}" title="Archive">
            <i data-lucide="archive"></i>
          </button>
        ` : variant === 'past' ? `
          <button class="member-action-btn" data-archive-event="${ev.id}" title="Move to cold storage">
            <i data-lucide="archive"></i>
          </button>
        ` : ''}
        <button class="member-action-btn danger" data-delete-event="${ev.id}" title="Delete">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `;
}

function renderTemplates() {
  if (templates.length === 0) {
    return `
      <div class="events-empty">
        <div class="events-empty-icon"><i data-lucide="repeat"></i></div>
        <p>No recurring templates yet. Set one up for weekly services like Sunday morning.</p>
        <button class="btn btn-primary" id="emptyAddTemplateBtn"><i data-lucide="plus"></i>New recurring</button>
      </div>
    `;
  }
  return templates.map(t => {
    const nextDates = nextOccurrences(t, 1);
    const nextDate = nextDates[0];
    const nextStr = nextDate ? nextDate.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' }) : '—';
    return `
      <div class="template-card" data-template-id="${esc(t.id)}">
        <div class="template-icon"><i data-lucide="repeat"></i></div>
        <div class="template-info">
          <div class="template-title">${esc(t.title)}</div>
          <div class="template-meta">
            <span class="template-meta-item"><i data-lucide="calendar-days"></i><strong>Every ${esc(weekdayName(t.weekday))}</strong></span>
            <span class="template-meta-item"><i data-lucide="clock"></i>${esc(t.time)}</span>
            <span class="template-meta-item"><i data-lucide="map-pin"></i>${esc(t.location)}</span>
            <span class="template-meta-item"><i data-lucide="calendar-clock"></i>Next: ${esc(nextStr)}</span>
          </div>
        </div>
        <div class="event-admin-actions">
          <button class="btn btn-light btn-sm" data-generate-template="${esc(t.id)}">
            <i data-lucide="plus"></i>Generate next 4
          </button>
          <button class="member-action-btn" data-edit-template="${esc(t.id)}" title="Edit">
            <i data-lucide="pen-line"></i>
          </button>
          <button class="member-action-btn danger" data-delete-template="${esc(t.id)}" title="Delete">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// MODALS
// ============================================================

// One-off event create/edit modal
function openOneOffModal(eventId = null) {
  const editing = eventId ? events.find(e => e.id === eventId) : null;

  // Build list of potential MDs and WLs from accounts
  const mdCandidates = accounts.filter(a => (a.roles || []).includes('Music Director'));
  const wlCandidates = accounts.filter(a => (a.roles || []).includes('Worship Leader'));

  // Find current MD/WL on this event for edit mode
  const currentMD = editing?.team.find(t => t.role === 'Music Director')?.name || '';
  const currentWL = editing?.team.find(t => t.role === 'Worship Leader')?.name || '';

  const content = `
    <div class="modal-head">
      <div class="modal-icon accent">
        <i data-lucide="${editing ? 'pen-line' : 'calendar-plus'}"></i>
      </div>
      <div>
        <h3 class="modal-title">${editing ? 'Edit event' : 'New event'}</h3>
        <p class="modal-sub">${editing
          ? 'Update event details, date, or assignments.'
          : 'Create a one-off service (Christmas Eve, special event, etc.)'
        }</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Event title *</label>
        <input class="modal-input" id="evTitle" type="text" placeholder="e.g. Christmas Eve Service" value="${esc(editing?.title || '')}" />
      </div>

      <div class="modal-row">
        <div class="modal-field">
          <label class="modal-label">Date *</label>
          <input class="modal-input" id="evDate" type="date" value="${esc(editing?.date || '')}" />
        </div>
        <div class="modal-field">
          <label class="modal-label">Time</label>
          <input class="modal-input" id="evTime" type="text" placeholder="9:00 AM" value="${esc(editing?.time || '')}" />
        </div>
      </div>

      <div class="modal-field">
        <label class="modal-label">Location</label>
        <input class="modal-input" id="evLocation" type="text" placeholder="Main Sanctuary" value="${esc(editing?.location || 'Main Sanctuary')}" />
      </div>

      <div class="modal-field">
        <label class="modal-label">Rehearsal (optional)</label>
        <input class="modal-input" id="evRehearsal" type="text" placeholder="Saturday, Dec 23 · 6:00 PM" value="${esc(editing?.rehearsal || '')}" />
      </div>

      <div class="modal-row">
        <div class="modal-field">
          <label class="modal-label">Music Director</label>
          <select class="modal-input" id="evMD">
            <option value="">— Unassigned —</option>
            ${mdCandidates.map(a => `<option value="${esc(a.name)}" ${a.name === currentMD ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
        <div class="modal-field">
          <label class="modal-label">Worship Leader</label>
          <select class="modal-input" id="evWL">
            <option value="">— Unassigned —</option>
            ${wlCandidates.map(a => `<option value="${esc(a.name)}" ${a.name === currentWL ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-primary" id="confirmEvent">
        <i data-lucide="${editing ? 'save' : 'plus'}"></i>${editing ? 'Save changes' : 'Create event'}
      </button>
    </div>
  `;

  openModal(content, {
    onBind: (modal) => {
      $('#evTitle', modal).focus();
      $('#confirmEvent', modal).addEventListener('click', () => {
        const title = $('#evTitle', modal).value.trim();
        const date = $('#evDate', modal).value;
        const time = $('#evTime', modal).value.trim();
        const location = $('#evLocation', modal).value.trim();
        const rehearsal = $('#evRehearsal', modal).value.trim();
        const mdName = $('#evMD', modal).value;
        const wlName = $('#evWL', modal).value;

        if (!title || !date) {
          showToast('Title and date are required', true);
          return;
        }

        if (editing) {
          // Replace MD and WL slots (admin override allowed)
          const newTeam = editing.team.filter(t => t.role !== 'Music Director' && t.role !== 'Worship Leader');
          if (mdName) {
            const acc = accounts.find(a => a.name === mdName);
            if (acc) newTeam.unshift({
              role: 'Music Director', userId: acc.id,
              name: acc.name, initials: acc.initials, color: acc.color,
              status: 'pending',
            });
          }
          if (wlName) {
            const acc = accounts.find(a => a.name === wlName);
            if (acc) newTeam.push({
              role: 'Worship Leader', userId: acc.id,
              name: acc.name, initials: acc.initials, color: acc.color,
              status: 'pending',
            });
          }
          updateEvent(editing.id, { title, date, time, location, rehearsal, team: newTeam });
          closeModal();
          render();
          showToast('Event updated');
        } else {
          addOneOffEvent({ title, date, time, location, rehearsal, mdName, worshipLeaderName: wlName });
          closeModal();
          render();
          showToast(`"${title}" created`);
        }
      });
    },
  });
}

// Recurring template modal
function openTemplateModal(templateId = null) {
  const editing = templateId ? templates.find(t => t.id === templateId) : null;

  const content = `
    <div class="modal-head">
      <div class="modal-icon accent">
        <i data-lucide="${editing ? 'pen-line' : 'repeat'}"></i>
      </div>
      <div>
        <h3 class="modal-title">${editing ? 'Edit recurring event' : 'New recurring event'}</h3>
        <p class="modal-sub">A template generates instances automatically (Sunday Service, midweek, etc.)</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Event title *</label>
        <input class="modal-input" id="tplTitle" type="text" placeholder="e.g. Sunday Morning Service" value="${esc(editing?.title || '')}" />
      </div>

      <div class="modal-field">
        <label class="modal-label">Recurs every *</label>
        <div class="weekday-picker">
          ${WEEKDAYS_SHORT.map((w, i) => `
            <button type="button" class="weekday-btn ${editing?.weekday === i ? 'active' : (!editing && i === 0 ? 'active' : '')}" data-weekday="${i}">${w}</button>
          `).join('')}
        </div>
      </div>

      <div class="modal-row">
        <div class="modal-field">
          <label class="modal-label">Time</label>
          <input class="modal-input" id="tplTime" type="text" placeholder="9:00 AM" value="${esc(editing?.time || '9:00 AM')}" />
        </div>
        <div class="modal-field">
          <label class="modal-label">Rehearsal time</label>
          <input class="modal-input" id="tplRehearsalTime" type="text" placeholder="6:00 PM" value="${esc(editing?.rehearsalTime || '6:00 PM')}" />
        </div>
      </div>

      <div class="modal-field">
        <label class="modal-label">Location</label>
        <input class="modal-input" id="tplLocation" type="text" placeholder="Main Sanctuary" value="${esc(editing?.location || 'Main Sanctuary')}" />
      </div>

      <div class="modal-field">
        <label class="modal-label">Rehearsal day</label>
        <select class="modal-input" id="tplOffset">
          <option value="-1" ${editing?.rehearsalDayOffset === -1 ? 'selected' : ''}>Day before</option>
          <option value="-2" ${editing?.rehearsalDayOffset === -2 ? 'selected' : ''}>2 days before</option>
          <option value="-3" ${editing?.rehearsalDayOffset === -3 ? 'selected' : ''}>3 days before</option>
          <option value="-7" ${editing?.rehearsalDayOffset === -7 ? 'selected' : ''}>1 week before</option>
          <option value="0" ${editing?.rehearsalDayOffset === 0 ? 'selected' : ''}>Same day</option>
        </select>
      </div>

      <div class="modal-field">
        <label class="modal-label">
          <i data-lucide="crown" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;margin-right:3px;color:var(--accent);"></i>
          Music Director rotation
        </label>
        <p class="modal-help">Each new generated event picks the next person on this list. The arrow shows who's up next.</p>
        <div class="rotation-editor" id="mdRotationEditor"></div>
      </div>

      <div class="modal-field">
        <label class="modal-label">
          <i data-lucide="mic-2" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;margin-right:3px;color:var(--amber);"></i>
          Worship Leader rotation
        </label>
        <p class="modal-help">Order who leads worship across upcoming events.</p>
        <div class="rotation-editor" id="wlRotationEditor"></div>
      </div>

      <div class="modal-field">
        <label class="modal-label">Next 4 occurrences (preview)</label>
        <div class="preview-list" id="tplPreview"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-primary" id="confirmTemplate">
        <i data-lucide="${editing ? 'save' : 'plus'}"></i>${editing ? 'Save changes' : 'Create template'}
      </button>
    </div>
  `;

  openModal(content, {
    onBind: (modal) => {
      // State for weekday selection
      let selectedDay = editing?.weekday ?? 0;

      // Working copies of rotations (don't mutate the template until save)
      const mdState = {
        order: editing?.mdRotation?.order ? [...editing.mdRotation.order] : [],
        nextIndex: editing?.mdRotation?.nextIndex ?? 0,
      };
      const wlState = {
        order: editing?.wlRotation?.order ? [...editing.wlRotation.order] : [],
        nextIndex: editing?.wlRotation?.nextIndex ?? 0,
      };

      function refreshPreview() {
        const preview = nextOccurrences({ weekday: selectedDay }, 4);
        const list = $('#tplPreview', modal);
        list.innerHTML = preview.map((d, i) => {
          // Show projected MD/WL based on rotation state
          const md = mdState.order.length
            ? accounts.find(a => a.id === mdState.order[(mdState.nextIndex + i) % mdState.order.length])
            : null;
          const wl = wlState.order.length
            ? accounts.find(a => a.id === wlState.order[(wlState.nextIndex + i) % wlState.order.length])
            : null;
          return `
            <div class="preview-item">
              <i data-lucide="calendar"></i>
              <span>${d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              ${md || wl ? `<span class="preview-assignees">${md ? `MD: <strong>${esc(md.firstName || md.name)}</strong>` : ''}${md && wl ? ' · ' : ''}${wl ? `WL: <strong>${esc(wl.firstName || wl.name)}</strong>` : ''}</span>` : ''}
            </div>
          `;
        }).join('');
        if (window.lucide) window.lucide.createIcons();
      }

      function renderRotationEditor(targetSel, state, kind /* 'md' | 'wl' */) {
        const roleNeeded = kind === 'md' ? 'Music Director' : 'Worship Leader';
        const inRotation = new Set(state.order);
        const candidates = accounts.filter(a =>
          !inRotation.has(a.id) &&
          Array.isArray(a.roles) &&
          a.roles.includes(roleNeeded)
        );

        const target = $(targetSel, modal);
        if (state.order.length === 0) {
          target.innerHTML = `
            <div class="rotation-empty-mini">
              <p>No one in rotation yet.</p>
            </div>
          `;
        } else {
          target.innerHTML = `
            <div class="rotation-mini-list">
              ${state.order.map((uid, idx) => {
                const acc = accounts.find(a => a.id === uid);
                if (!acc) return '';
                const isNext = idx === state.nextIndex;
                return `
                  <div class="rotation-mini-row ${isNext ? 'is-next' : ''}">
                    <div class="rotation-mini-pos">${idx + 1}</div>
                    <div class="avatar avatar-sm ${acc.color ? 'avatar-' + acc.color : ''}">${esc(acc.initials)}</div>
                    <div class="rotation-mini-name">
                      ${esc(acc.name)}
                      ${isNext ? '<span class="rotation-next-tag">Up next</span>' : ''}
                    </div>
                    <div class="rotation-mini-actions">
                      ${idx > 0 ? `<button type="button" class="rotation-mini-btn" data-rot-move-up="${idx}" data-rot-kind="${kind}" title="Move up"><i data-lucide="chevron-up"></i></button>` : ''}
                      ${idx < state.order.length - 1 ? `<button type="button" class="rotation-mini-btn" data-rot-move-down="${idx}" data-rot-kind="${kind}" title="Move down"><i data-lucide="chevron-down"></i></button>` : ''}
                      <button type="button" class="rotation-mini-btn danger" data-rot-remove="${idx}" data-rot-kind="${kind}" title="Remove"><i data-lucide="x"></i></button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }

        // Append "add" picker
        target.insertAdjacentHTML('beforeend', `
          <div class="rotation-mini-add">
            <select class="modal-input rotation-mini-select" data-rot-add-kind="${kind}">
              <option value="">+ Add to rotation…</option>
              ${candidates.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
        `);

        if (window.lucide) window.lucide.createIcons();
        bindRotationControls();
      }

      function bindRotationControls() {
        $$('[data-rot-add-kind]', modal).forEach(sel => {
          sel.addEventListener('change', () => {
            const kind = sel.dataset.rotAddKind;
            const id = sel.value;
            if (!id) return;
            const state = kind === 'md' ? mdState : wlState;
            state.order.push(id);
            renderBothRotations();
          });
        });
        $$('[data-rot-move-up]', modal).forEach(btn => {
          btn.addEventListener('click', () => {
            const kind = btn.dataset.rotKind;
            const idx = parseInt(btn.dataset.rotMoveUp);
            const state = kind === 'md' ? mdState : wlState;
            // Track next-pointer user
            const nextUserId = state.order[state.nextIndex];
            [state.order[idx - 1], state.order[idx]] = [state.order[idx], state.order[idx - 1]];
            if (nextUserId) state.nextIndex = state.order.indexOf(nextUserId);
            renderBothRotations();
          });
        });
        $$('[data-rot-move-down]', modal).forEach(btn => {
          btn.addEventListener('click', () => {
            const kind = btn.dataset.rotKind;
            const idx = parseInt(btn.dataset.rotMoveDown);
            const state = kind === 'md' ? mdState : wlState;
            const nextUserId = state.order[state.nextIndex];
            [state.order[idx + 1], state.order[idx]] = [state.order[idx], state.order[idx + 1]];
            if (nextUserId) state.nextIndex = state.order.indexOf(nextUserId);
            renderBothRotations();
          });
        });
        $$('[data-rot-remove]', modal).forEach(btn => {
          btn.addEventListener('click', () => {
            const kind = btn.dataset.rotKind;
            const idx = parseInt(btn.dataset.rotRemove);
            const state = kind === 'md' ? mdState : wlState;
            // Track who was next
            const nextUserId = state.order[state.nextIndex];
            state.order.splice(idx, 1);
            if (nextUserId && state.order.includes(nextUserId)) {
              state.nextIndex = state.order.indexOf(nextUserId);
            } else if (state.nextIndex >= state.order.length) {
              state.nextIndex = 0;
            }
            renderBothRotations();
          });
        });
      }

      function renderBothRotations() {
        renderRotationEditor('#mdRotationEditor', mdState, 'md');
        renderRotationEditor('#wlRotationEditor', wlState, 'wl');
        refreshPreview();
      }

      renderBothRotations();

      // Weekday picker
      $$('.weekday-btn', modal).forEach(btn => {
        btn.addEventListener('click', () => {
          $$('.weekday-btn', modal).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedDay = parseInt(btn.dataset.weekday);
          refreshPreview();
        });
      });

      $('#tplTitle', modal).focus();

      $('#confirmTemplate', modal).addEventListener('click', () => {
        const title = $('#tplTitle', modal).value.trim();
        const time = $('#tplTime', modal).value.trim();
        const location = $('#tplLocation', modal).value.trim();
        const rehearsalTime = $('#tplRehearsalTime', modal).value.trim();
        const offset = parseInt($('#tplOffset', modal).value);

        if (!title) {
          showToast('Title is required', true);
          return;
        }

        const rotPayload = {
          mdRotation: { order: [...mdState.order], nextIndex: mdState.nextIndex },
          wlRotation: { order: [...wlState.order], nextIndex: wlState.nextIndex },
        };

        if (editing) {
          updateTemplate(editing.id, {
            title, weekday: selectedDay, time, location,
            rehearsalDayOffset: offset, rehearsalTime,
            ...rotPayload,
          });
          closeModal();
          render();
          showToast('Template updated');
        } else {
          addTemplate({
            title, weekday: selectedDay, time, location,
            rehearsalDayOffset: offset, rehearsalTime,
            ...rotPayload,
          });
          closeModal();
          render();
          showToast(`"${title}" recurring template created`);
        }
      });
    },
  });
}

// Delete event confirmation
function openDeleteEventModal(eventId) {
  const ev = events.find(e => e.id === eventId);
  if (!ev) return;
  const content = `
    <div class="modal-head">
      <div class="modal-icon"><i data-lucide="alert-triangle"></i></div>
      <div>
        <h3 class="modal-title">Delete ${esc(ev.title)}?</h3>
        <p class="modal-sub">This event will be removed completely along with its setlist and team assignments. This can't be undone.</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <p style="font-size: 13px; color: var(--text-2);">
        <strong>${ev.team.length}</strong> assigned member(s) · <strong>${(ev.setlist || []).length}</strong> song(s) · ${esc(new Date(ev.date).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }))}
      </p>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-danger" id="confirmDeleteEv">
        <i data-lucide="trash-2"></i>Yes, delete event
      </button>
    </div>
  `;
  openModal(content, {
    onBind: (modal) => {
      $('#confirmDeleteEv', modal).addEventListener('click', () => {
        const r = deleteEvent(eventId);
        if (!r.ok) { showToast('Delete failed', true); return; }
        closeModal();
        render();
        showToast(`"${ev.title}" deleted`);
      });
    },
  });
}

// Delete template confirmation
function openDeleteTemplateModal(templateId) {
  const t = templates.find(x => x.id === templateId);
  if (!t) return;
  const content = `
    <div class="modal-head">
      <div class="modal-icon"><i data-lucide="alert-triangle"></i></div>
      <div>
        <h3 class="modal-title">Delete recurring template?</h3>
        <p class="modal-sub"><strong>${esc(t.title)}</strong> will stop auto-generating new events. Existing generated events stay.</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-danger" id="confirmDeleteTpl">
        <i data-lucide="trash-2"></i>Yes, delete template
      </button>
    </div>
  `;
  openModal(content, {
    onBind: (modal) => {
      $('#confirmDeleteTpl', modal).addEventListener('click', () => {
        const r = deleteTemplate(templateId);
        if (!r.ok) { showToast('Delete failed', true); return; }
        closeModal();
        render();
        showToast('Template deleted');
      });
    },
  });
}

// ============================================================
// BINDINGS
// ============================================================
function bindToolbar() {
  $$('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.tab = btn.dataset.tab;
      // Re-render tabs and content
      $$('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
      renderTab();
    });
  });

  const addOneOff = $('#addOneOffBtn');
  if (addOneOff) addOneOff.addEventListener('click', () => openOneOffModal());

  const addTpl = $('#addTemplateBtn');
  if (addTpl) addTpl.addEventListener('click', () => openTemplateModal());
}

function bindList() {
  // Empty-state add buttons
  const emptyAdd = $('#emptyAddBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openOneOffModal());
  const emptyAddTpl = $('#emptyAddTemplateBtn');
  if (emptyAddTpl) emptyAddTpl.addEventListener('click', () => openTemplateModal());

  // Event actions
  $$('[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => openOneOffModal(parseInt(btn.dataset.editEvent)));
  });
  $$('[data-delete-event]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteEventModal(parseInt(btn.dataset.deleteEvent)));
  });
  $$('[data-archive-event]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.archiveEvent);
      const r = archiveEvent(id);
      if (r.ok) {
        render();
        showToast('Moved to cold storage');
      }
    });
  });

  // Template actions
  $$('[data-edit-template]').forEach(btn => {
    btn.addEventListener('click', () => openTemplateModal(btn.dataset.editTemplate));
  });
  $$('[data-delete-template]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteTemplateModal(btn.dataset.deleteTemplate));
  });
  $$('[data-generate-template]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.generateTemplate;
      const r = generateFromTemplate(id, 4);
      if (!r.ok) { showToast('Generation failed', true); return; }
      if (r.created.length === 0) {
        showToast('No new events created — next 4 already exist');
      } else {
        showToast(`Generated ${r.created.length} new event(s)`);
        ui.tab = 'upcoming';
        render();
      }
    });
  });
}

// ============================================================
// BOOT
// ============================================================
(async () => {
  await initShell();
  render();
  // Re-render automatically when any Firestore collection changes so other
  // users see updates (add/edit/delete) without refreshing the page.
  onDataChange(() => render());
})();
