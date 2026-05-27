// ============================================================
// WORSHIPSYNC · js/pages/my-schedules.js
// ============================================================

import { $, $$, esc, uid, showToast, openModal, closeModal } from '../shared/ui.js';
import {
  currentUser, events, memberDirectory, notifications, accounts,
  ASSIGNABLE_ROLES, PROTECTED_ROLES,
  persist, persistEvent, memberFitsRole, pushNotification,
  markNotificationRead, markAllNotificationsRead,
  getEventsForUser, setMyEventStatus, getMyNotifications, onDataChange,
  formatRehearsal, parseLegacyRehearsal,
} from '../shared/data.js';
import { initShell } from '../shared/shell.js';
import { renderVerseCard, bindVerseRefresh } from '../shared/verse.js';
import { refreshNotificationsUI, onNotificationsChange, timeAgo } from '../shared/notifications.js';

// ============================================================
// LOCAL UI STATE
// ============================================================
// Only show events the current user is assigned to.
function getMyEvents() {
  if (!currentUser) return [];
  return getEventsForUser(currentUser.id);
}

const ui = {
  expandedEventId: undefined,  // undefined = not yet initialized; null = user explicitly closed all
  editingEventId: null,
  notifExpanded: false,
};

// ============================================================
// HELPERS
// ============================================================
const getEvent = (id, role) => {
  // Return only if the user is on this event
  const e = events.find(ev => ev.id === id);
  if (!e) return null;
  const entry = role
    ? e.team.find(t => t.userId === currentUser.id && t.role === role)
    : e.team.find(t => t.userId === currentUser.id);
  if (!entry) return null;
  return { ...e, yourRole: entry.role, yourStatus: entry.status || 'pending', roleKey: `${e.id}|${entry.role}` };
};
// Parse a roleKey like "42|Music Director" → [42, "Music Director"]
// Also accepts a plain numeric id (legacy) → [id, undefined]
const parseRoleKey = (key) => {
  if (!key) return [null, undefined];
  const sep = key.indexOf('|');
  if (sep === -1) return [parseInt(key), undefined];
  return [parseInt(key.slice(0, sep)), key.slice(sep + 1)];
};
const isMD = (event) => event.yourRole === 'Music Director';
const canEdit = (event) => isMD(event) && event.yourStatus === 'accepted';

// Shorthand notification creator
const notif = (config) => {
  pushNotification(config);
  refreshNotificationsUI();
};

// Notify each admin (each gets their own targeted copy)
function notifyAdmins(config) {
  accounts.filter(a => a.isAdmin).forEach(admin => {
    pushNotification({ ...config, forUserId: admin.id });
  });
  refreshNotificationsUI();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const root = $('#page');
  if (!currentUser) {
    // Should never happen — initShell awaits auth which redirects to login
    // before render() is reached. Guard anyway so we don't crash.
    root.innerHTML = `<div class="empty-schedule"><h3>Loading…</h3></div>`;
    return;
  }
  // Lazy initial expansion: pick the first event the first time we render.
  // Uses undefined as "not yet set" so that null (user explicitly closed) is preserved.
  if (ui.expandedEventId === undefined) {
    ui.expandedEventId = getMyEvents()[0]?.id ?? null;
  }
  root.innerHTML = `
    <div class="page-head">
      <h1 class="page-greeting">Hello, ${esc(currentUser.firstName)} <span>— here's what's on your calendar.</span></h1>
      <p class="page-sub">Review your assignments, accept or decline, and manage events you're directing.</p>
    </div>

    <div class="dashboard-grid">
      <div>
        ${(() => {
          const my = getMyEvents();
          if (my.length === 0) {
            return `
              <div class="empty-schedule">
                <div class="empty-schedule-icon"><i data-lucide="calendar-x"></i></div>
                <h3>No assignments yet</h3>
                <p>When the admin or your music director assigns you to an event, it'll show up here.</p>
              </div>
            `;
          }
          return my.map(renderEventCard).join('');
        })()}
      </div>
      <aside class="side-col">
        ${renderVerseCard()}
        ${renderNotificationsCard()}
      </aside>
    </div>
  `;

  bindAll();
  bindVerseRefresh();
  if (window.lucide) window.lucide.createIcons();
}

function renderEventCard(event) {
  const isOpen = ui.expandedEventId === event.id;
  const editing = canEdit(event) && ui.editingEventId === event.id;
  const d = new Date(event.date);
  const month = d.toLocaleString('en', { month: 'short' });
  const day = d.getDate();
  const weekday = d.toLocaleString('en', { weekday: 'long' });

  let statusBadge = '';
  if (event.yourStatus === 'accepted') {
    statusBadge = `<span class="status-badge accepted"><i data-lucide="check"></i>Accepted</span>`;
  } else if (event.yourStatus === 'declined') {
    statusBadge = `<span class="status-badge declined"><i data-lucide="x"></i>Declined</span>`;
  } else {
    statusBadge = `<span class="status-badge pending"><i data-lucide="clock"></i>Awaiting response</span>`;
  }

  const rolePill = isMD(event)
    ? `<span class="md-badge"><i data-lucide="crown"></i>Music Director</span>`
    : `<span class="pill pill-accent"><i data-lucide="user-check"></i>${esc(event.yourRole)}</span>`;

  return `
    <div class="event-card ${isOpen ? 'open' : ''}" id="event-${event.roleKey}" data-event-id="${event.id}" data-role-key="${event.roleKey}">
      <button class="event-card-head" data-toggle="${event.id}">
        <div class="event-date">
          <div class="event-date-month">${month}</div>
          <div class="event-date-day">${day}</div>
        </div>
        <div class="event-info">
          <div class="event-title-row">
            <h3 class="event-title">${esc(event.title)}</h3>
            ${rolePill}
            ${statusBadge}
          </div>
          <div class="event-meta">
            <span class="event-meta-item"><i data-lucide="calendar"></i>${esc(weekday)}</span>
            <span class="event-meta-item"><i data-lucide="clock"></i>${esc(event.time)}</span>
            <span class="event-meta-item"><i data-lucide="map-pin"></i>${esc(event.location)}</span>
          </div>
        </div>
        <div class="event-chev"><i data-lucide="chevron-down"></i></div>
      </button>

      <div class="event-body">
        <div class="event-body-inner">
          <div class="event-divider"></div>

          ${renderDecisionArea(event)}
          ${renderMDControls(event, editing)}

          ${event.yourStatus !== 'declined' ? `
            ${renderSetlistSection(event, editing)}
            ${renderTeamSection(event, editing)}
            ${renderRehearsalSection(event, editing)}
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderDecisionArea(event) {
  if (event.yourStatus === 'pending') {
    const mdPending = isMD(event);
    return `
      <div class="decision-card ${mdPending ? 'md' : ''}">
        <div class="decision-icon">
          <i data-lucide="${mdPending ? 'crown' : 'mail-question'}"></i>
        </div>
        <div class="decision-text">
          <p class="decision-title">${mdPending
            ? 'You\'ve been assigned as Music Director'
            : 'You have a new assignment'
          }</p>
          <p class="decision-sub">${mdPending
            ? 'Accept to start building this event — add songs, assign musicians, and set the rehearsal.'
            : `You're being asked to play <strong>${esc(event.yourRole)}</strong>. Let the team know if you can make it.`
          }</p>
        </div>
        <div class="decision-actions">
          <button class="btn btn-danger btn-sm" data-decline="${event.roleKey}">
            <i data-lucide="x"></i>Decline
          </button>
          <button class="btn btn-success btn-sm" data-accept="${event.roleKey}">
            <i data-lucide="check"></i>Accept
          </button>
        </div>
      </div>
    `;
  }

  if (event.yourStatus === 'declined') {
    return `
      <div class="declined-notice">
        <i data-lucide="info"></i>
        <div class="declined-notice-text">
          <strong>You declined this assignment.</strong> The admin has been notified and will reassign your role.
        </div>
        <button data-undo-decline="${event.roleKey}">Undo</button>
      </div>
    `;
  }
  return '';
}

function renderMDControls(event, editing) {
  if (!canEdit(event)) return '';
  return `
    <div class="md-controls-bar">
      <div class="md-controls-icon"><i data-lucide="crown"></i></div>
      <div class="md-controls-text">
        <p class="md-controls-title">${editing ? 'Editing event' : 'You\'re directing this event'}</p>
        <p class="md-controls-sub">${editing
          ? 'Make changes below — they save as you go.'
          : 'Tap "Edit event" to manage songs, musicians, and rehearsal.'
        }</p>
      </div>
      <button class="btn ${editing ? 'btn-light' : 'btn-primary'} btn-sm" data-toggle-edit="${event.id}">
        <i data-lucide="${editing ? 'check' : 'pen-line'}"></i>${editing ? 'Done editing' : 'Edit event'}
      </button>
    </div>
  `;
}

// ============================================================
// SETLIST
// ============================================================
function renderSetlistSection(event, editing) {
  return `
    <section class="sub">
      <div class="sub-head">
        <p class="sub-title">Setlist</p>
        ${editing
          ? `<span class="sub-meta">Editing · changes save automatically</span>`
          : `<span class="sub-meta">Tap a song to open in audio studio</span>`
        }
      </div>
      <div class="songs-grid">
        ${event.setlist.map(song => renderSongCard(song, event.id, editing)).join('')}
        ${editing ? `
          <button class="song-card-add" data-add-song="${event.id}">
            <div class="song-card-add-icon"><i data-lucide="plus"></i></div>
            Add a song
          </button>
        ` : ''}
      </div>
    </section>
  `;
}

function renderSongCard(song, eventId, editing) {
  if (!editing) {
    return `
      <button class="song-card" data-song-id="${esc(song.id)}" style="--song-color: ${song.color};">
        <div class="song-card-top">
          <span class="song-key-chip">Key · ${esc(song.key)}</span>
          <span class="song-arrow"><i data-lucide="arrow-up-right"></i></span>
        </div>
        <div class="song-card-title-wrap">
          <h4 class="song-title">${esc(song.title)}</h4>
          ${song.artist ? `<p class="song-artist">${esc(song.artist)}</p>` : ''}
        </div>
        <div class="song-foot">
          <i data-lucide="link-2"></i>
          <span>${esc(song.link)}</span>
        </div>
      </button>
    `;
  }

  return `
    <div class="song-card editable" style="--song-color: ${song.color};">
      <div class="song-edit-field">
        <label>Song title</label>
        <input class="song-edit-input" type="text" value="${esc(song.title)}"
               data-song-edit="${esc(song.id)}" data-field="title" data-event-id="${eventId}" />
      </div>
      <div class="song-edit-field">
        <label>Artist / author</label>
        <input class="song-edit-input" type="text" value="${esc(song.artist || '')}" placeholder="e.g. Hezekiah Walker"
               data-song-edit="${esc(song.id)}" data-field="artist" data-event-id="${eventId}" />
      </div>
      <div class="song-edit-field">
        <label>Key</label>
        <input class="song-edit-input mono" type="text" value="${esc(song.key)}" placeholder="e.g. C, G → A"
               data-song-edit="${esc(song.id)}" data-field="key" data-event-id="${eventId}" />
      </div>
      <div class="song-edit-field">
        <label>Link</label>
        <input class="song-edit-input" type="text" value="${esc(song.link)}" placeholder="youtube.com/..."
               data-song-edit="${esc(song.id)}" data-field="link" data-event-id="${eventId}" />
      </div>
      <div class="song-card-actions">
        <label class="song-action-btn ${song.audioFile ? 'success' : ''}" for="audio-${esc(song.id)}">
          <i data-lucide="${song.audioFile ? 'check-circle-2' : 'upload'}"></i>
          ${song.audioFile ? 'Audio loaded' : 'Upload audio'}
          <input id="audio-${esc(song.id)}" type="file" accept="audio/*"
                 class="file-input-hidden" data-upload-audio="${esc(song.id)}" data-event-id="${eventId}" />
        </label>
        <button class="song-action-btn danger" data-delete-song="${esc(song.id)}" data-event-id="${eventId}">
          <i data-lucide="trash-2"></i>Remove
        </button>
      </div>
      ${song.audioFile ? `
        <div class="song-uploaded" style="margin-top: 4px;">
          <i data-lucide="music"></i>${esc(song.audioFile.name)}
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================================
// TEAM
// ============================================================
function renderTeamSection(event, editing) {
  return `
    <section class="sub">
      <div class="sub-head">
        <p class="sub-title">Assigned musicians</p>
        <span class="sub-meta">
          ${editing
            ? 'Music Director is locked · everyone else can be swapped or removed'
            : `${event.team.length} members`
          }
        </span>
      </div>
      <div class="team-grid">
        ${event.team.map((m, idx) => renderTeamCard(m, idx, event.id, editing)).join('')}
        ${editing ? renderAddTeamSlot(event.id) : ''}
      </div>
    </section>
  `;
}

function renderTeamCard(member, index, eventId, editing) {
  const isProtected = PROTECTED_ROLES.includes(member.role);
  const isYou = member.userId === currentUser.id;
  const showActions = editing && !isProtected;

  return `
    <div class="team-card ${isYou ? 'you' : ''} ${editing && isProtected ? 'protected' : ''}">
      <div class="avatar avatar-sm ${member.color ? 'avatar-' + member.color : ''}">${esc(member.initials)}</div>
      <div class="team-card-text">
        <p class="team-card-role">${esc(member.role)}</p>
        <p class="team-card-name">
          ${isYou ? 'You' : esc(member.name)}
          ${isYou ? '<span class="you-tag">You</span>' : ''}
        </p>
      </div>
      ${showActions ? `
        <div class="team-card-actions">
          <button class="team-card-swap" data-swap-member="${eventId}" data-index="${index}" title="Swap musician">
            <i data-lucide="repeat-2"></i>
          </button>
          <button class="team-card-remove" data-remove-member="${eventId}" data-index="${index}" title="Remove">
            <i data-lucide="x"></i>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderAddTeamSlot(eventId) {
  return `
    <button class="team-card empty" data-add-member="${eventId}">
      <div class="avatar avatar-sm"><i data-lucide="plus" style="width:14px;height:14px;"></i></div>
      <div class="team-card-text">
        <p class="team-card-role">Empty role</p>
        <p class="team-card-name">Assign a musician</p>
      </div>
    </button>
  `;
}

// ============================================================
// REHEARSAL
// ============================================================
function renderRehearsalSection(event, editing) {
  // For the edit form we want the structured (date, time) pair to populate
  // the inputs. Fall back to parsing the legacy display string for events
  // that still only have `event.rehearsal` set.
  const legacy = (event.rehearsalDate || event.rehearsalTime)
    ? { date: event.rehearsalDate || '', time: event.rehearsalTime || '' }
    : parseLegacyRehearsal(event.rehearsal || '');

  return `
    <section class="sub">
      <div class="rehearsal-banner">
        <div class="rehearsal-info">
          <div class="rehearsal-icon"><i data-lucide="calendar-clock"></i></div>
          <div class="rehearsal-body">
            <div class="rehearsal-label">Rehearsal</div>
            ${editing ? `
              <div class="rehearsal-edit-row">
                <input type="date"
                       class="rehearsal-edit-input rehearsal-edit-date"
                       value="${esc(legacy.date)}"
                       data-edit-rehearsal-date="${event.id}"
                       aria-label="Rehearsal date" />
                <input type="text"
                       class="rehearsal-edit-input rehearsal-edit-time"
                       value="${esc(legacy.time)}"
                       data-edit-rehearsal-time="${event.id}"
                       placeholder="6:00 PM"
                       aria-label="Rehearsal time" />
              </div>
            ` : `
              <div class="rehearsal-time">${esc(event.rehearsal) || '<span class="rehearsal-empty">No rehearsal scheduled</span>'}</div>
            `}
          </div>
        </div>
        ${!editing && event.rehearsal ? `
          <button class="btn btn-primary btn-sm"><i data-lucide="calendar-plus"></i>Add to calendar</button>
        ` : ''}
      </div>
    </section>
  `;
}

// ============================================================
// NOTIFICATIONS CARD (right rail)
// ============================================================
function renderNotificationsCard() {
  const COLLAPSED = 3;
  const myNotifs = getMyNotifications();
  const visible = ui.notifExpanded ? myNotifs : myNotifs.slice(0, COLLAPSED);
  const unreadCount = myNotifs.filter(n => n.unread).length;
  const hasMore = myNotifs.length > COLLAPSED;

  return `
    <div class="card" id="notifCard">
      <div class="card-head">
        <div>
          <h3 class="card-title">Notifications</h3>
          ${unreadCount > 0
            ? `<p class="card-sub">${unreadCount} unread</p>`
            : `<p class="card-sub">All caught up</p>`
          }
        </div>
        ${unreadCount > 0
          ? `<button class="btn btn-ghost btn-sm" id="markAllReadCard">
              <i data-lucide="check-check"></i>Mark all
            </button>`
          : ''
        }
      </div>
      <div class="notif-list">
        ${visible.length === 0 ? `
          <p style="font-size: 13px; color: var(--text-3); padding: 12px 0;">No notifications yet.</p>
        ` : visible.map(n => `
          <button class="notif-item-card ${n.unread ? 'unread' : ''}"
                  data-notif-card-id="${esc(n.id)}"
                  data-notif-event-id="${n.eventId ?? ''}">
            <div class="notif-icon ${n.tone === 'accent' ? '' : n.tone}"><i data-lucide="${esc(n.icon)}"></i></div>
            <div class="notif-item-card-body">
              <p class="notif-text">${n.text}</p>
              <p class="notif-time">${esc(timeAgo(n.createdAt))}</p>
            </div>
            ${n.unread ? '<span class="notif-unread-dot" aria-label="Unread"></span>' : ''}
          </button>
        `).join('')}
      </div>
      ${hasMore ? `
        <button class="notif-toggle-btn" id="toggleNotifExpand">
          ${ui.notifExpanded
            ? `<i data-lucide="chevron-up"></i>Show less`
            : `<i data-lucide="chevron-down"></i>View all (${myNotifs.length})`
          }
        </button>
      ` : ''}
    </div>
  `;
}

// Re-render only the notif card (without re-rendering whole page)
function refreshNotifCard() {
  const card = $('#notifCard');
  if (card) {
    card.insertAdjacentHTML('afterend', renderNotificationsCard());
    card.remove();
    if (window.lucide) window.lucide.createIcons();
    bindNotifCard();
  }
}

// ============================================================
// FOCUS-EVENT (jump to event when notification clicked)
// ============================================================
function focusEvent(eventId) {
  ui.expandedEventId = eventId;
  render();
  // Wait for DOM, then scroll + flash
  requestAnimationFrame(() => {
    const card = $('#event-' + eventId);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('focused');
      setTimeout(() => card.classList.remove('focused'), 1500);
    }
  });
}

// Listen for bell-dropdown clicks
window.addEventListener('worshipsync:focus-event', (e) => {
  focusEvent(e.detail.eventId);
});

// Handle URL hash on load (e.g. clicked notif from another page)
function checkHashFocus() {
  const m = location.hash.match(/^#event-(\d+)$/);
  if (m) {
    const id = parseInt(m[1]);
    if (getEvent(id)) {
      focusEvent(id);
      // Clear hash so refresh doesn't re-trigger
      history.replaceState(null, '', location.pathname);
    }
  }
}

// Subscribe to bell-dropdown changes so the card stays in sync
onNotificationsChange(() => refreshNotifCard());

// ============================================================
// MODALS
// ============================================================
function openDeclineModal(roleKey) {
  const [eventId, role] = parseRoleKey(roleKey);
  const event = getEvent(eventId, role);
  if (!event) return;

  const content = `
    <div class="modal-head">
      <div class="modal-icon"><i data-lucide="circle-alert"></i></div>
      <div>
        <h3 class="modal-title">Decline this assignment?</h3>
        <p class="modal-sub">You're stepping away from <strong>${esc(event.title)}</strong> as ${esc(event.yourRole)}. The admin will reassign your role.</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Reason (optional)</label>
        <textarea class="modal-textarea" id="declineReason" placeholder="e.g. I'm out of town that weekend"></textarea>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-danger" id="confirmDecline">
        <i data-lucide="x"></i>Yes, decline
      </button>
    </div>
  `;

  openModal(content, {
    onBind: (modal) => {
      $('#confirmDecline', modal).addEventListener('click', () => {
        setMyEventStatus(eventId, 'declined', role);
        if (ui.editingEventId === eventId) ui.editingEventId = null;

        // Personal note
        notif({
          eventId,
          forUserId: currentUser.id,
          icon: 'x-circle',
          tone: 'amber',
          text: `You declined <strong>${esc(event.yourRole)}</strong> for ${esc(event.title)}.`,
        });
        // Tell admins so they can reassign
        notifyAdmins({
          eventId,
          icon: 'user-x',
          tone: 'amber',
          text: `<strong>${esc(currentUser.name)}</strong> declined ${esc(event.yourRole)} for ${esc(event.title)}.`,
        });

        closeModal();
        render();
        showToast('Assignment declined. Admin notified.');
      });
    },
  });
}

function openAddSongModal(eventId) {
  const content = `
    <div class="modal-head">
      <div class="modal-icon accent"><i data-lucide="music-2"></i></div>
      <div>
        <h3 class="modal-title">Add a song</h3>
        <p class="modal-sub">Enter the song details. You can upload the audio file after.</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Song title</label>
        <input class="modal-input" id="newSongTitle" type="text" placeholder="e.g. Build My Life" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Artist / author</label>
        <input class="modal-input" id="newSongArtist" type="text" placeholder="e.g. Pat Barrett" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Key</label>
        <input class="modal-input" id="newSongKey" type="text" placeholder="e.g. G, or A → B" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Link</label>
        <input class="modal-input" id="newSongLink" type="text" placeholder="youtube.com/watch?v=..." />
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-primary" id="confirmAddSong">
        <i data-lucide="plus"></i>Add song
      </button>
    </div>
  `;

  openModal(content, {
    onBind: (modal) => {
      $('#newSongTitle', modal).focus();
      $('#confirmAddSong', modal).addEventListener('click', () => {
        const event = getEvent(eventId);
        const title = $('#newSongTitle', modal).value.trim();
        const artist = $('#newSongArtist', modal).value.trim();
        const key = $('#newSongKey', modal).value.trim();
        const link = $('#newSongLink', modal).value.trim();
        if (!title || !key) {
          showToast('Please fill in title and key', true);
          return;
        }
        const colors = ['#7C5BF2', '#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#14B8A6'];
        event.setlist.push({
          id: uid(),
          title, artist: artist || '', key, link: link || '—',
          color: colors[event.setlist.length % colors.length],
          audioFile: null,
        });
        persistEvent(event.id);
        notif({
          eventId,
          icon: 'music-2',
          tone: 'accent',
          text: `You added <strong>"${esc(title)}"</strong> to ${event.title}'s setlist.`,
        });
        closeModal();
        render();
        showToast(`"${title}" added`);
      });
    },
  });
}

function openAssignMemberModal(eventId, swapIndex = null) {
  const event = getEvent(eventId);
  if (!event) return;

  const existingMember = swapIndex !== null ? event.team[swapIndex] : null;
  const lockedRole = existingMember ? existingMember.role : null;

  openModal(buildAssignContent(event, lockedRole, swapIndex), {
    wide: true,
    onBind: (modal) => bindAssignModal(modal, event, lockedRole, swapIndex),
  });
}

function buildAssignContent(event, lockedRole, swapIndex) {
  const existingMember = swapIndex !== null ? event.team[swapIndex] : null;
  const targetRole = lockedRole || ASSIGNABLE_ROLES[0];

  // Filter directory by role match + exclude existing team members (except the one being swapped)
  const candidates = memberDirectory.filter(person => {
    const onTeam = event.team.some((t, idx) =>
      t.userId === person.id && idx !== swapIndex
    );
    if (onTeam) return false;
    return memberFitsRole(person, targetRole);
  });

  return `
    <div class="modal-head">
      <div class="modal-icon accent"><i data-lucide="user-plus"></i></div>
      <div>
        <h3 class="modal-title">${existingMember
          ? `Swap ${esc(existingMember.role)}`
          : 'Add musician'
        }</h3>
        <p class="modal-sub">${existingMember
          ? `Currently assigned: ${esc(existingMember.name)}`
          : 'Pick a role, then choose someone who plays it.'
        }</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Role</label>
        ${lockedRole ? `
          <input class="modal-input" type="text" value="${esc(lockedRole)}" readonly id="newMemberRole" />
        ` : `
          <select class="modal-input" id="newMemberRole">
            ${ASSIGNABLE_ROLES.map(r => `<option value="${esc(r)}" ${r === targetRole ? 'selected' : ''}>${esc(r)}</option>`).join('')}
            <option value="__custom__">+ Custom role…</option>
          </select>
          <input class="modal-input" type="text" id="customRole" placeholder="Type a custom role" style="margin-top: 8px; display: none;" />
        `}
      </div>
      <div class="modal-field">
        <label class="modal-label">Available musicians (${candidates.length})</label>
        <div class="member-list" id="memberList">
          ${renderCandidates(candidates)}
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Close</button>
    </div>
  `;
}

function renderCandidates(candidates) {
  if (candidates.length === 0) {
    return `<p style="font-size: 13px; color: var(--text-3); padding: 12px;">
      No one in the directory plays this role.
    </p>`;
  }
  return candidates.map(p => `
    <button class="member-row" data-pick-user-id="${esc(p.id)}"
            data-pick-name="${esc(p.name)}"
            data-initials="${esc(p.initials)}" data-color="${esc(p.color)}">
      <div class="avatar avatar-sm avatar-${esc(p.color)}">${esc(p.initials)}</div>
      <div class="member-row-text">
        <div class="member-row-name">${esc(p.name)}</div>
        <div class="member-row-roles">${p.roles.join(' · ')}</div>
      </div>
      <i data-lucide="check"></i>
    </button>
  `).join('');
}

function bindAssignModal(modal, event, lockedRole, swapIndex) {
  const roleSelect = $('#newMemberRole', modal);
  const customInput = $('#customRole', modal);
  const memberList = $('#memberList', modal);

  // Re-filter list whenever role changes
  function updateList() {
    let currentRole;
    if (lockedRole) {
      currentRole = lockedRole;
    } else {
      currentRole = roleSelect.value;
      if (currentRole === '__custom__') {
        const custom = customInput.value.trim();
        currentRole = custom || ASSIGNABLE_ROLES[0];
      }
    }
    const filtered = memberDirectory.filter(person => {
      const onTeam = event.team.some((t, idx) =>
        t.userId === person.id && idx !== swapIndex
      );
      if (onTeam) return false;
      return memberFitsRole(person, currentRole);
    });
    // Update count
    const label = modal.querySelector('.modal-field:last-of-type .modal-label');
    if (label) label.textContent = `Available musicians (${filtered.length})`;
    memberList.innerHTML = renderCandidates(filtered);
    if (window.lucide) window.lucide.createIcons();
    bindMemberClicks();
  }

  if (roleSelect && roleSelect.tagName === 'SELECT') {
    roleSelect.addEventListener('change', () => {
      const showCustom = roleSelect.value === '__custom__';
      customInput.style.display = showCustom ? 'block' : 'none';
      if (showCustom) customInput.focus();
      updateList();
    });
    if (customInput) {
      customInput.addEventListener('input', () => updateList());
    }
  }

  function bindMemberClicks() {
    $$('[data-pick-name]', modal).forEach(btn => {
      btn.addEventListener('click', () => {
        let role;
        if (lockedRole) {
          role = lockedRole;
        } else {
          role = roleSelect.value;
          if (role === '__custom__') {
            role = customInput.value.trim();
            if (!role) { showToast('Enter a custom role name', true); return; }
          }
        }
        const newMember = {
          role,
          userId: btn.dataset.pickUserId,
          name: btn.dataset.pickName,
          initials: btn.dataset.initials,
          color: btn.dataset.color,
          status: 'pending',
        };
        const before = swapIndex !== null ? event.team[swapIndex] : null;
        if (swapIndex !== null) {
          event.team[swapIndex] = newMember;
        } else {
          event.team.push(newMember);
        }
        persistEvent(event.id);

        // Notify the MD (current user) — visible to them
        notif({
          eventId: event.id,
          forUserId: currentUser.id,
          icon: before ? 'repeat-2' : 'user-plus',
          tone: 'green',
          text: before
            ? `<strong>${esc(newMember.name)}</strong> replaced <strong>${esc(before.name)}</strong> as ${esc(role)} for ${esc(event.title)}.`
            : `<strong>${esc(newMember.name)}</strong> assigned as ${esc(role)} for ${esc(event.title)}.`,
        });
        // Notify the newly assigned musician
        notif({
          eventId: event.id,
          forUserId: newMember.userId,
          icon: 'user-plus',
          tone: 'accent',
          text: `You've been assigned as <strong>${esc(role)}</strong> for ${esc(event.title)}.`,
        });

        closeModal();
        render();
        showToast(`${newMember.name} assigned as ${role}`);
      });
    });
  }

  bindMemberClicks();
}

// ============================================================
// BINDINGS
// ============================================================
function bindAll() {
  // Expand / collapse event card
  $$('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.toggle);
      ui.expandedEventId = ui.expandedEventId === id ? null : id;
      render();
    });
  });

  // Open song in audio studio
  $$('[data-song-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      location.href = 'studio.html?song=' + encodeURIComponent(btn.dataset.songId);
    });
  });

  // Accept
  $$('[data-accept]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [id, role] = parseRoleKey(btn.dataset.accept);
      const event = getEvent(id, role);
      if (!event) return;
      setMyEventStatus(id, 'accepted', role);
      notif({
        eventId: id,
        forUserId: currentUser.id,
        icon: 'check-circle-2',
        tone: 'green',
        text: `You accepted <strong>${esc(event.yourRole)}</strong> for ${esc(event.title)}.`,
      });
      notifyAdmins({
        eventId: id,
        icon: 'check-circle-2',
        tone: 'green',
        text: `<strong>${esc(currentUser.name)}</strong> accepted ${esc(event.yourRole)} for ${esc(event.title)}.`,
      });
      render();
      showToast(isMD(event)
        ? 'Accepted — you can now edit this event'
        : 'Assignment accepted'
      );
    });
  });

  // Decline
  $$('[data-decline]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeclineModal(btn.dataset.decline);
    });
  });

  // Undo decline
  $$('[data-undo-decline]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [id, role] = parseRoleKey(btn.dataset.undoDecline);
      setMyEventStatus(id, 'pending', role);
      render();
      showToast('Restored to pending');
    });
  });

  // Toggle MD edit mode
  $$('[data-toggle-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.toggleEdit);
      const turningOn = ui.editingEventId !== id;
      ui.editingEventId = turningOn ? id : null;
      render();
      if (turningOn) showToast('Edit mode on');
    });
  });

  // Song field edits
  $$('[data-song-edit]').forEach(input => {
    input.addEventListener('input', () => {
      const songId = input.dataset.songEdit;
      const field = input.dataset.field;
      for (const event of events) {
        const song = event.setlist.find(s => s.id === songId);
        if (song) { song[field] = input.value; break; }
      }
    });
    input.addEventListener('blur', () => {
      const eventId = parseInt(input.dataset.eventId);
      const event = getEvent(eventId);
      persistEvent(event.id);
      const songId = input.dataset.songEdit;
      const song = event?.setlist.find(s => s.id === songId);
      if (song && input.value.trim()) {
        notif({
          eventId,
          icon: 'pen-line',
          tone: 'accent',
          text: `You updated <strong>"${esc(song.title)}"</strong> for ${esc(event.title)}.`,
        });
      }
      showToast('Saved');
    });
  });

  // Audio upload
  $$('[data-upload-audio]').forEach(input => {
    input.addEventListener('change', () => {
      const songId = input.dataset.uploadAudio;
      const file = input.files[0];
      if (!file) return;
      let foundSong, foundEvent;
      for (const event of events) {
        const song = event.setlist.find(s => s.id === songId);
        if (song) {
          song.audioFile = { name: file.name, size: file.size, type: file.type };
          foundSong = song;
          foundEvent = event;
          break;
        }
      }
      persistEvent(event.id);
      if (foundSong && foundEvent) {
        notif({
          eventId: foundEvent.id,
          icon: 'upload',
          tone: 'green',
          text: `Audio uploaded for <strong>"${esc(foundSong.title)}"</strong>.`,
        });
      }
      render();
      showToast(`"${file.name}" uploaded`);
    });
  });

  // Delete song
  $$('[data-delete-song]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const songId = btn.dataset.deleteSong;
      const eventId = parseInt(btn.dataset.eventId);
      const event = getEvent(eventId);
      if (!event) return;
      const removed = event.setlist.find(s => s.id === songId);
      event.setlist = event.setlist.filter(s => s.id !== songId);
      persistEvent(event.id);
      if (removed) {
        notif({
          eventId,
          icon: 'trash-2',
          tone: 'amber',
          text: `You removed <strong>"${esc(removed.title)}"</strong> from ${esc(event.title)}.`,
        });
      }
      render();
      if (removed) showToast(`Removed "${removed.title}"`);
    });
  });

  // Add song
  $$('[data-add-song]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddSongModal(parseInt(btn.dataset.addSong));
    });
  });

  // Swap member
  $$('[data-swap-member]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const eventId = parseInt(btn.dataset.swapMember);
      const index = parseInt(btn.dataset.index);
      openAssignMemberModal(eventId, index);
    });
  });

  // Remove member
  $$('[data-remove-member]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const eventId = parseInt(btn.dataset.removeMember);
      const index = parseInt(btn.dataset.index);
      const event = getEvent(eventId);
      if (!event) return;
      const removed = event.team[index];
      event.team.splice(index, 1);
      persistEvent(event.id);
      if (removed) {
        notif({
          eventId,
          icon: 'user-minus',
          tone: 'amber',
          text: `<strong>${esc(removed.name)}</strong> removed from ${esc(event.title)}.`,
        });
      }
      render();
      if (removed) showToast(`Removed ${removed.name}`);
    });
  });

  // Add musician
  $$('[data-add-member]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAssignMemberModal(parseInt(btn.dataset.addMember), null);
    });
  });

  // Edit rehearsal — date + time inputs live next to each other. We update
  // the structured fields on every input event (so a quick blur doesn't lose
  // data), then on blur of EITHER field we recompute the display string,
  // persist, notify, and toast.
  function applyRehearsalEdit(eventId, sourceLabel) {
    const event = getEvent(eventId);
    if (!event) return;
    // Re-derive from whatever inputs exist in the DOM for this event (so we
    // pick up the latest value even if the user is mid-edit on one field).
    const dateEl = $(`[data-edit-rehearsal-date="${eventId}"]`);
    const timeEl = $(`[data-edit-rehearsal-time="${eventId}"]`);
    const date = dateEl ? dateEl.value : (event.rehearsalDate || '');
    const time = timeEl ? timeEl.value.trim() : (event.rehearsalTime || '');
    event.rehearsalDate = date;
    event.rehearsalTime = time;
    event.rehearsal = formatRehearsal(date, time);
    persistEvent(eventId);
    notif({
      eventId,
      icon: 'calendar-clock',
      tone: 'amber',
      text: event.rehearsal
        ? `Rehearsal updated for <strong>${esc(event.title)}</strong>: ${esc(event.rehearsal)}.`
        : `Rehearsal cleared for <strong>${esc(event.title)}</strong>.`,
    });
    showToast(`Rehearsal ${event.rehearsal ? 'updated' : 'cleared'}`);
  }

  $$('[data-edit-rehearsal-date]').forEach(input => {
    // Date pickers fire 'change' (not 'input') when the user picks a date,
    // so we treat that as the commit point for the date input.
    input.addEventListener('change', () => {
      applyRehearsalEdit(parseInt(input.dataset.editRehearsalDate), 'date');
    });
  });
  $$('[data-edit-rehearsal-time]').forEach(input => {
    input.addEventListener('blur', () => {
      applyRehearsalEdit(parseInt(input.dataset.editRehearsalTime), 'time');
    });
  });

  bindNotifCard();
}

function bindNotifCard() {
  // Toggle expand/collapse
  const toggle = $('#toggleNotifExpand');
  if (toggle) {
    toggle.addEventListener('click', () => {
      ui.notifExpanded = !ui.notifExpanded;
      refreshNotifCard();
    });
  }

  // Mark all read button on the card
  const markAll = $('#markAllReadCard');
  if (markAll) {
    markAll.addEventListener('click', () => {
      markAllNotificationsRead();
      refreshNotificationsUI();
      refreshNotifCard();
    });
  }

  // Click a notification card → mark read + jump to event
  $$('[data-notif-card-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.notifCardId;
      const eventId = btn.dataset.notifEventId;
      markNotificationRead(id);
      refreshNotificationsUI();
      if (eventId) {
        focusEvent(parseInt(eventId));
      } else {
        refreshNotifCard();
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
  checkHashFocus();

  // Re-render when any Firestore data changes so schedule updates from admins
  // (assignments, setlist edits, new events) appear instantly without refresh.
  // Caveat: if the user is currently typing in an inline editor (song fields,
  // rehearsal date/time, etc.) or interacting with a modal, a render() call
  // would tear down their input mid-keystroke. In those cases we defer the
  // render until the input blurs.
  let _renderPending = false;
  onDataChange(() => {
    const el = document.activeElement;
    const editingInline = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
      el.dataset && (
        el.dataset.songEdit ||
        el.dataset.editRehearsalDate ||
        el.dataset.editRehearsalTime
      );
    const modalOpen = !!document.getElementById('modalRoot');
    if (editingInline || modalOpen) {
      if (_renderPending) return;
      _renderPending = true;
      const flush = () => {
        _renderPending = false;
        // Only render if nothing's still in progress; otherwise rebook.
        const stillEditing = document.activeElement && document.activeElement.dataset && (
          document.activeElement.dataset.songEdit ||
          document.activeElement.dataset.editRehearsalDate ||
          document.activeElement.dataset.editRehearsalTime
        );
        const stillModal = !!document.getElementById('modalRoot');
        if (stillEditing || stillModal) {
          _renderPending = true;
          setTimeout(flush, 400);
        } else {
          render();
        }
      };
      if (editingInline) el.addEventListener('blur', flush, { once: true });
      else setTimeout(flush, 400);
      return;
    }
    render();
  });
})();
