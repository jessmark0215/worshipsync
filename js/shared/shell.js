// ============================================================
// WORSHIPSYNC · js/shared/shell.js
// Sidebar/topbar wiring. Injects admin nav for admin users.
// Initializes shared widgets (notifications, search, analytics).
// ============================================================

import { $, $$, esc } from './ui.js';
import { initBellDropdown } from './notifications.js';
import { initSearch } from './search.js';
import { initAnalytics } from './analytics.js';
import { isAdmin, currentUser, loadAllFromFirestore } from './data.js';
import { requireAuth, logOut, getAuthUser } from './auth.js';
import { isFirebaseConfigured } from './firebase-config.js';

function getCurrentPageId() {
  const path = location.pathname.split('/').pop() || 'index.html';
  const name = path.replace('.html', '');
  if (name === 'index' || name === '') return 'my-schedules';
  return name;
}

const ADMIN_NAV = [
  { page: 'admin-overview', icon: 'layout-dashboard', label: 'Overview' },
  { page: 'admin-events',   icon: 'calendar-cog',     label: 'Events' },
  { page: 'admin-members',  icon: 'users-round',      label: 'Members' },
  { page: 'admin-analytics',icon: 'chart-line',       label: 'Analytics' },
  { page: 'admin-security', icon: 'shield-check',     label: 'Security' },
];

function injectAdminNav() {
  if (!isAdmin()) return;
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  if ($('.admin-nav-section', sidebar)) return; // already injected

  // Insert before the watermark / at the bottom of sidebar
  const section = document.createElement('div');
  section.className = 'admin-nav-section';
  section.innerHTML = `
    <div class="sidebar-divider"></div>
    <p class="nav-section-label">
      <i data-lucide="shield" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;margin-right:4px;"></i>
      Administration
    </p>
    <nav class="nav" aria-label="Admin">
      ${ADMIN_NAV.map(item => `
        <a class="nav-item" href="${item.page}.html" data-page="${item.page}">
          <i data-lucide="${item.icon}"></i>
          <span>${esc(item.label)}</span>
        </a>
      `).join('')}
    </nav>
  `;
  sidebar.appendChild(section);
}


function updateTopbarUser() {
  const nameEl = $('.topbar-user-name');
  const roleEl = $('.topbar-user-role');
  const avEl = $('.topbar-user .avatar:not(.user-switcher .avatar)');
  if (!currentUser) {
    if (nameEl) nameEl.textContent = 'Welcome';
    if (roleEl) roleEl.textContent = '';
    if (avEl) avEl.textContent = '?';
    return;
  }
  if (nameEl) nameEl.textContent = currentUser.name;
  if (roleEl) roleEl.textContent = (currentUser.primaryRole || 'Musician') + (currentUser.isAdmin ? ' · Admin' : '');
  if (avEl) avEl.textContent = currentUser.initials;
}

// Add a logout button to the sidebar's bottom
function injectLogoutButton() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  if ($('.sidebar-logout', sidebar)) return;

  const wrap = document.createElement('div');
  wrap.className = 'sidebar-logout-wrap';
  wrap.innerHTML = `
    <div class="sidebar-divider"></div>
    <button class="nav-item sidebar-logout" id="logoutBtn">
      <i data-lucide="log-out"></i>
      <span>Log out</span>
    </button>
  `;
  sidebar.appendChild(wrap);
  $('#logoutBtn', sidebar).addEventListener('click', async () => {
    await logOut();
  });
}

export async function initShell({ requireAuthGate = true } = {}) {
  // ---- Auth gate (always first) ----
  if (requireAuthGate && isFirebaseConfigured()) {
    const authUser = await requireAuth({ requireVerified: true });
    if (!authUser) return; // redirected
  }

  // ---- Load all data from Firestore ----
  // Pages downstream read from `events`, `accounts`, etc. — these arrays
  // start empty and get populated here. Must complete before render().
  try {
    await loadAllFromFirestore();
  } catch (e) {
    console.error('Failed to load Firestore data:', e);
    // Show a friendly error banner
    document.body.insertAdjacentHTML('afterbegin', `
      <div style="position:fixed;top:0;left:0;right:0;background:#FEE2E2;color:#7F1D1D;padding:12px 20px;font-size:13px;font-weight:600;z-index:99999;border-bottom:1px solid #FCA5A5">
        Couldn't load data from Firestore. Check your network connection and refresh.
      </div>
    `);
  }

  // Inject admin nav before highlighting (so admin items get highlighted too)
  injectAdminNav();

  // Highlight active nav item
  const current = getCurrentPageId();
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === current);
  });

  // Live user in topbar
  updateTopbarUser();

  // Logout button at bottom of sidebar
  injectLogoutButton();

  // Mobile menu open/close
  const sidebar = $('#sidebar');
  const overlay = $('#sidebarOverlay');
  const openBtn = $('#menuOpen');
  const closeBtn = $('#sidebarClose');

  if (openBtn) openBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  });
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('modalRoot')) {
      closeSidebar();
    }
  });

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Initialize shared widgets
  initBellDropdown();
  initSearch();
  initAnalytics();

  if (window.lucide) window.lucide.createIcons();
}
