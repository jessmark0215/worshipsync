// ============================================================
// WORSHIPSYNC · js/pages/admin-overview.js
// Admin overview dashboard. Shown only if currentUser is admin.
// ============================================================

import { $, $$, esc } from '../shared/ui.js';
import {
  currentUser, accounts, events, memberDirectory, notifications, isAdmin,
  analytics as analyticsState, onDataChange
} from '../shared/data.js';
import { initShell } from '../shared/shell.js';
import {
  getOnlineUsers, isOnline, getTotalTimeMs, getSessionCount,
  formatDuration, timeAgo
} from '../shared/analytics.js';

function render() {
  const root = $('#page');

  // Gate non-admins
  if (!isAdmin()) {
    root.innerHTML = `
      <div class="admin-gate">
        <div class="admin-gate-icon"><i data-lucide="shield-alert"></i></div>
        <h2>Admin access required</h2>
        <p>This area is for administrators. If you should have access, ask an existing admin to upgrade your account.</p>
        <a class="btn btn-primary" href="index.html">
          <i data-lucide="arrow-left"></i>Back to my schedules
        </a>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Compute stats
  const totalMembers = accounts.length + memberDirectory.length;
  const adminCount = accounts.filter(a => a.isAdmin).length;
  const onlineIds = getOnlineUsers();
  const onlineCount = onlineIds.length;
  const upcoming = events.filter(e => new Date(e.date) >= new Date()).length;
  const pendingDecisions = events.reduce((sum, e) =>
    sum + (e.team || []).filter(t => t.status === 'pending').length, 0
  );

  root.innerHTML = `
    <div class="admin-head">
      <div>
        <h1 class="admin-head-title">Admin overview</h1>
        <p class="admin-head-sub">Welcome back, ${esc(currentUser.firstName)}. Here's what's happening across WorshipSync.</p>
      </div>
      <div class="admin-head-actions">
        <button class="btn btn-light btn-sm"><i data-lucide="download"></i>Export</button>
        <a class="btn btn-primary btn-sm" href="admin-events.html"><i data-lucide="calendar-plus"></i>New event</a>
      </div>
    </div>

    <div class="stats-grid">
      ${statCard('Online now', onlineCount, 'people active right now', 'circle-user-round', 'green')}
      ${statCard('Upcoming events', upcoming, 'in the next 30 days', 'calendar-days', 'purple')}
      ${statCard('Total members', totalMembers, `${adminCount} admin${adminCount === 1 ? '' : 's'}`, 'users-round', 'blue')}
      ${statCard('Pending responses', pendingDecisions, 'waiting on decisions', 'clock', 'amber')}
    </div>

    <div class="admin-cols">
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Who's online</h3>
            <p class="card-sub">${onlineCount} of ${accounts.length} members active</p>
          </div>
        </div>
        ${renderOnlineList(onlineIds)}
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Event status</h3>
            <p class="card-sub">Upcoming services and their assignments</p>
          </div>
          <a class="btn btn-ghost btn-sm" href="admin-events.html">All events <i data-lucide="arrow-right"></i></a>
        </div>
        ${renderEventStatus()}
      </div>
    </div>

    <div class="card" style="margin-top: 16px;">
      <div class="card-head">
        <div>
          <h3 class="card-title">Quick actions</h3>
          <p class="card-sub">Common admin tasks</p>
        </div>
      </div>
      <div class="quick-actions">
        ${quickAction('admin-events.html', 'calendar-plus', 'Create event', 'Add a recurring or one-off service')}
        ${quickAction('admin-members.html', 'user-plus', 'Add member', 'Invite a musician or admin')}
        ${quickAction('admin-events.html', 'list-ordered', 'Edit rotation', 'Open a recurring template to manage MD/WL order')}
        ${quickAction('admin-analytics.html', 'chart-line', 'View analytics', 'Visits, practice time, attendance')}
        ${quickAction('admin-security.html', 'shield-check', 'Security', 'Sessions, permissions, audit log')}
        ${quickAction('admin-events.html#archive', 'archive', 'Archive', 'Past events and cold storage')}
      </div>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

function statCard(label, value, trend, icon, tone) {
  return `
    <div class="stat-card">
      <div class="stat-card-head">
        <div class="stat-icon ${tone}"><i data-lucide="${icon}"></i></div>
        <span class="stat-label">${esc(label)}</span>
      </div>
      <div class="stat-value">${value}</div>
      <div class="stat-trend">${esc(trend)}</div>
    </div>
  `;
}

function renderOnlineList(onlineIds) {
  if (accounts.length === 0) {
    return `<p style="color: var(--text-3); font-size: 13px;">No accounts yet.</p>`;
  }
  // Show all accounts; online first
  const sorted = [...accounts].sort((a, b) => {
    const aOnline = isOnline(a.id) ? 1 : 0;
    const bOnline = isOnline(b.id) ? 1 : 0;
    return bOnline - aOnline;
  });
  return `
    <div class="online-list">
      ${sorted.map(a => {
        const online = isOnline(a.id);
        const last = analyticsState.online[a.id];
        const totalTime = getTotalTimeMs(a.id);
        const sessions = getSessionCount(a.id);
        return `
          <div class="online-row ${online ? 'is-online' : ''}">
            <div class="online-status">
              <div class="avatar avatar-sm">${esc(a.initials)}</div>
              <span class="online-status-dot"></span>
            </div>
            <div class="online-meta">
              <p class="online-name">${esc(a.name)} ${a.isAdmin ? '<span class="md-badge" style="font-size:9px;padding:2px 6px;"><i data-lucide="shield"></i>Admin</span>' : ''}</p>
              <p class="online-sub">${esc(a.primaryRole)} · ${sessions} session${sessions === 1 ? '' : 's'} · ${formatDuration(totalTime)} total</p>
            </div>
            <span class="online-time">${online ? 'now' : (last ? timeAgo(last) : '—')}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderEventStatus() {
  const upcoming = events
    .filter(e => new Date(e.date) >= new Date(new Date().setHours(0,0,0,0)))
    .slice(0, 6);

  if (upcoming.length === 0) {
    return `<p style="color: var(--text-3); font-size: 13px;">No upcoming events.</p>`;
  }

  return `
    <div class="event-status-list">
      ${upcoming.map(ev => {
        const d = new Date(ev.date);
        const team = ev.team || [];
        const acceptedCount = team.filter(t => t.status === 'accepted').length;
        const pendingCount = team.filter(t => t.status === 'pending').length;
        const totalCount = team.length;
        return `
          <div class="event-status-row">
            <div class="event-status-date">
              <div class="event-status-month">${d.toLocaleString('en', { month: 'short' })}</div>
              <div class="event-status-day">${d.getDate()}</div>
            </div>
            <div class="event-status-body">
              <p class="event-status-title">${esc(ev.title)}</p>
              <div class="event-status-meta">
                <span><strong>${acceptedCount}/${totalCount}</strong> accepted</span>
                <span><strong>${ev.setlist.length}</strong> songs</span>
                ${pendingCount > 0 ? `<span><strong>${pendingCount}</strong> pending</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

const PROTECTED_NAMES = ['Music Director'];

function quickAction(href, icon, title, sub) {
  return `
    <a class="quick-action" href="${esc(href)}">
      <div class="quick-action-icon"><i data-lucide="${esc(icon)}"></i></div>
      <div class="quick-action-title">${esc(title)}</div>
      <div class="quick-action-sub">${esc(sub)}</div>
    </a>
  `;
}

// Boot
(async () => {
  await initShell();
  render();
  // Re-render when Firestore data changes (new members, events, etc.)
  onDataChange(() => { if (isAdmin()) render(); });
})();

// Refresh online status every 30s
setInterval(() => {
  if (isAdmin()) render();
}, 30_000);
