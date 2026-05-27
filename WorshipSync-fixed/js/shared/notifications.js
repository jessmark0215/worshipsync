// ============================================================
// WorshipSync · js/shared/notifications.js
// Bell dropdown + helpers. Mounted automatically by shell.js.
//
// Behavior:
//  - Bell icon in topbar opens a dropdown showing notifications
//  - Unread count badge updates live
//  - Clicking a notification marks it read AND navigates to the
//    related event (if any), expanding it on the My Schedules page
//  - "Mark all read" clears all unread
// ============================================================

import { $, $$, esc } from './ui.js';
import {
  notifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  getMyNotifications,
} from './data.js';

export function timeAgo(createdAt) {
  const seconds = Math.floor((Date.now() - (createdAt || Date.now())) / 1000);
  if (seconds < 30) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Pub/sub for in-page listeners (e.g. the side rail card on My Schedules)
const listeners = new Set();
export function onNotificationsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach(fn => fn()); }

// ============================================================
// BELL DROPDOWN
// ============================================================
let isOpen = false;

export function initBellDropdown() {
  const bell = $('.notif-btn');
  if (!bell) return;

  updateBadge();

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!isOpen) return;
    const dropdown = $('#notifDropdown');
    if (dropdown && !dropdown.contains(e.target) && !bell.contains(e.target)) {
      closeDropdown();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeDropdown();
  });
}

function toggleDropdown() {
  if (isOpen) closeDropdown();
  else openDropdown();
}

function openDropdown() {
  closeDropdown();
  const bell = $('.notif-btn');
  if (!bell) return;

  const dropdown = document.createElement('div');
  dropdown.id = 'notifDropdown';
  dropdown.className = 'notif-dropdown';
  dropdown.innerHTML = renderDropdownContent();
  document.body.appendChild(dropdown);
  positionDropdown(bell, dropdown);

  if (window.lucide) window.lucide.createIcons();
  bindDropdownEvents();

  isOpen = true;
  window.addEventListener('resize', repositionOnce);
  requestAnimationFrame(() => dropdown.classList.add('open'));
}

function repositionOnce() {
  const bell = $('.notif-btn');
  const dropdown = $('#notifDropdown');
  if (bell && dropdown) positionDropdown(bell, dropdown);
}

function positionDropdown(bell, dropdown) {
  const rect = bell.getBoundingClientRect();
  const right = window.innerWidth - rect.right;
  const top = rect.bottom + 8;
  dropdown.style.top = `${top}px`;
  dropdown.style.right = `${Math.max(16, right)}px`;
}

function closeDropdown() {
  const dropdown = $('#notifDropdown');
  if (dropdown) {
    dropdown.classList.remove('open');
    setTimeout(() => dropdown.remove(), 180);
  }
  window.removeEventListener('resize', repositionOnce);
  isOpen = false;
}

function renderDropdownContent() {
  const unread = getUnreadNotificationCount();
  const items = getMyNotifications().slice(0, 10);

  return `
    <div class="notif-dropdown-head">
      <div>
        <p class="notif-dropdown-title">Notifications</p>
        <p class="notif-dropdown-sub">${unread > 0 ? `${unread} unread` : `You're all caught up`}</p>
      </div>
      <div class="notif-dropdown-head-actions">
        ${unread > 0
          ? `<button class="notif-dropdown-action" id="markAllReadDropdown">
              <i data-lucide="check-check"></i>Mark all read
            </button>`
          : ''
        }
        <button class="notif-dropdown-close" id="notifDropdownClose" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
    </div>

    <div class="notif-dropdown-list">
      ${items.length === 0 ? `
        <div class="notif-dropdown-empty">
          <i data-lucide="inbox"></i>
          <p>No notifications yet</p>
        </div>
      ` : items.map(n => `
        <button class="notif-dropdown-item ${n.unread ? 'unread' : ''}"
                data-notif-id="${esc(n.id)}"
                data-notif-event-id="${n.eventId ?? ''}">
          <div class="notif-icon ${n.tone === 'accent' ? '' : n.tone}"><i data-lucide="${esc(n.icon)}"></i></div>
          <div class="notif-dropdown-item-body">
            <p class="notif-text">${n.text}</p>
            <p class="notif-time">${esc(timeAgo(n.createdAt))}</p>
          </div>
          ${n.unread ? '<span class="notif-unread-dot" aria-label="Unread"></span>' : ''}
        </button>
      `).join('')}
    </div>
  `;
}

function bindDropdownEvents() {
  const markBtn = $('#markAllReadDropdown');
  if (markBtn) {
    markBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      markAllNotificationsRead();
      refresh();
    });
  }

  // Explicit close button (important for small screens where the dropdown fills the screen)
  const closeBtn = $('#notifDropdownClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDropdown();
    });
  }

  $$('[data-notif-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.notifId;
      const eventId = btn.dataset.notifEventId;
      markNotificationRead(id);

      // If notification links to an event, navigate / jump to it
      if (eventId) {
        const evIdNum = parseInt(eventId);
        // Are we on the My Schedules page?
        const onSchedulesPage = location.pathname.endsWith('index.html')
          || location.pathname.endsWith('/')
          || location.pathname === '';

        if (onSchedulesPage) {
          // Tell the page to expand the matching event
          closeDropdown();
          window.dispatchEvent(new CustomEvent('worshipsync:focus-event', {
            detail: { eventId: evIdNum },
          }));
        } else {
          // Navigate to My Schedules with the event hash
          location.href = `index.html#event-${evIdNum}`;
        }
      } else {
        refresh();
      }
    });
  });
}

function refresh() {
  const dropdown = $('#notifDropdown');
  if (dropdown) {
    dropdown.innerHTML = renderDropdownContent();
    if (window.lucide) window.lucide.createIcons();
    bindDropdownEvents();
  }
  updateBadge();
  emit();
}

// ============================================================
// BADGE
// ============================================================
export function updateBadge() {
  const badge = $('.notif-btn .notif-badge');
  if (!badge) return;
  const count = getUnreadNotificationCount();
  if (count === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'grid';
    badge.textContent = count > 9 ? '9+' : String(count);
  }
}

// Allow pages to trigger a badge + dropdown refresh externally
export function refreshNotificationsUI() {
  refresh();
}
