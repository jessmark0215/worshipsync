// ============================================================
// WORSHIPSYNC · js/pages/admin-members.js
// CRUD for accounts (musicians + admins) and their roles.
// ============================================================

import { $, $$, esc, uid, showToast, openModal, closeModal } from '../shared/ui.js';
import {
  currentUser, accounts, isAdmin,
  addAccount, updateAccount, deleteAccount, getMemberAssignments,
  INSTRUMENT_ROLES, onDataChange,
} from '../shared/data.js';
import { initShell } from '../shared/shell.js';

// ============================================================
// LOCAL UI STATE
// ============================================================
const ui = {
  search: '',
  filter: 'all', // all | admins | musicians | seed
};

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

  const visible = getFilteredMembers();
  const adminCount = accounts.filter(a => a.isAdmin).length;
  const musicianCount = accounts.filter(a => Array.isArray(a.roles) && a.roles.length > 0).length;
  const seedCount = accounts.filter(a => a.isSeedAdmin).length;

  root.innerHTML = `
    <div class="admin-head">
      <div>
        <h1 class="admin-head-title">Members</h1>
        <p class="admin-head-sub">${accounts.length} accounts · ${adminCount} admin${adminCount === 1 ? '' : 's'} · ${musicianCount} active musician${musicianCount === 1 ? '' : 's'}</p>
      </div>
      <div class="admin-head-actions">
        <button class="btn btn-primary btn-sm" id="addMemberBtn">
          <i data-lucide="user-plus"></i>Add member
        </button>
      </div>
    </div>

    <div class="members-toolbar">
      <div class="members-search">
        <i data-lucide="search"></i>
        <input type="text" id="membersSearch" placeholder="Search by name, email, or role..." value="${esc(ui.search)}" />
      </div>
      <div class="members-filters">
        ${filterChip('all',       'All',       accounts.length)}
        ${filterChip('admins',    'Admins',    adminCount, 'shield')}
        ${filterChip('musicians', 'Musicians', musicianCount, 'music-2')}
        ${seedCount > 0 ? filterChip('seed', 'Seed admins', seedCount, 'sprout') : ''}
      </div>
    </div>

    <div class="members-table-wrap">
      ${visible.length === 0 ? renderEmpty() : renderTable(visible)}
    </div>
  `;

  bindAll();
  if (window.lucide) window.lucide.createIcons();
}

function filterChip(value, label, count, icon = null) {
  const active = ui.filter === value;
  return `
    <button class="filter-chip ${active ? 'active' : ''}" data-filter="${value}">
      ${icon ? `<i data-lucide="${icon}"></i>` : ''}
      ${esc(label)}
      <span class="count">${count}</span>
    </button>
  `;
}

function getFilteredMembers() {
  let list = accounts.slice();
  if (ui.filter === 'admins') list = list.filter(a => a.isAdmin);
  else if (ui.filter === 'musicians') list = list.filter(a => Array.isArray(a.roles) && a.roles.length > 0);
  else if (ui.filter === 'seed') list = list.filter(a => a.isSeedAdmin);

  const q = ui.search.trim().toLowerCase();
  if (q) {
    list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q) ||
      (a.roles || []).some(r => r.toLowerCase().includes(q)) ||
      (a.primaryRole || '').toLowerCase().includes(q)
    );
  }

  // Sort: current user first, then admins, then alphabetically
  list.sort((a, b) => {
    if (a.id === currentUser.id) return -1;
    if (b.id === currentUser.id) return 1;
    if (a.isAdmin !== b.isAdmin) return b.isAdmin - a.isAdmin;
    return a.name.localeCompare(b.name);
  });
  return list;
}

function renderEmpty() {
  return `
    <div class="members-empty">
      <i data-lucide="users-round"></i>
      <p>No members match your filters.</p>
    </div>
  `;
}

function renderTable(members) {
  return `
    <table class="members-table">
      <thead>
        <tr>
          <th>Member</th>
          <th class="col-roles">Roles</th>
          <th class="col-email">Email</th>
          <th class="col-joined">Joined</th>
          <th style="text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${members.map(renderRow).join('')}
      </tbody>
    </table>
  `;
}

function renderRow(m) {
  const isYou = m.id === currentUser.id;
  const roles = Array.isArray(m.roles) ? m.roles : [];

  return `
    <tr data-member-id="${esc(m.id)}">
      <td>
        <div class="member-cell">
          <div class="avatar avatar-md ${m.color ? 'avatar-' + m.color : ''}">${esc(m.initials)}</div>
          <div class="member-cell-text">
            <div class="member-cell-name">
              ${esc(m.name)}
              ${m.isAdmin ? '<span class="admin-badge-mini"><i data-lucide="shield"></i>Admin</span>' : ''}
              ${m.isSeedAdmin ? '<span class="seed-badge">Seed</span>' : ''}
              ${isYou ? '<span class="you-badge-mini">You</span>' : ''}
            </div>
            <div class="member-cell-email">${esc(m.primaryRole || '—')}</div>
          </div>
        </div>
      </td>
      <td class="col-roles">
        <div class="role-tags">
          ${roles.length === 0
            ? '<span class="role-tag empty">No instrument roles</span>'
            : roles.map((r, i) => `
              <span class="role-tag ${i === 0 && r === m.primaryRole ? 'primary' : ''}">${esc(r)}</span>
            `).join('')
          }
        </div>
      </td>
      <td class="col-email">
        <span class="joined-date">${esc(m.email || '—')}</span>
      </td>
      <td class="col-joined">
        <span class="joined-date">${m.joinedAt ? formatDate(m.joinedAt) : '—'}</span>
      </td>
      <td>
        <div class="member-actions">
          <button class="member-action-btn" data-edit-member="${esc(m.id)}" title="Edit">
            <i data-lucide="pen-line"></i>
          </button>
          <button class="member-action-btn danger" data-delete-member="${esc(m.id)}" title="Delete"
                  ${isYou ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ============================================================
// MODALS — Add / Edit
// ============================================================
function openMemberFormModal(memberId = null) {
  const editing = memberId ? accounts.find(a => a.id === memberId) : null;

  const content = `
    <div class="modal-head">
      <div class="modal-icon accent">
        <i data-lucide="${editing ? 'pen-line' : 'user-plus'}"></i>
      </div>
      <div>
        <h3 class="modal-title">${editing ? 'Edit member' : 'Add new member'}</h3>
        <p class="modal-sub">${editing
          ? `Update ${esc(editing.name)}'s account details.`
          : 'Create an account for a musician or admin.'
        }</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Full name *</label>
        <input class="modal-input" id="memberName" type="text" placeholder="e.g. Jess Mark" value="${esc(editing?.name || '')}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Email</label>
        <input class="modal-input" id="memberEmail" type="email" placeholder="jess@church.org" value="${esc(editing?.email || '')}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Primary role</label>
        <input class="modal-input" id="memberPrimaryRole" type="text" placeholder="e.g. Guitarist" value="${esc(editing?.primaryRole || '')}" />
      </div>

      <div class="modal-field">
        <label class="modal-label">Signed-up for these instruments / roles</label>
        <div class="role-checkboxes">
          ${INSTRUMENT_ROLES.map(role => {
            const checked = (editing?.roles || []).includes(role);
            return `
              <label class="role-checkbox-item">
                <input type="checkbox" name="role" value="${esc(role)}" ${checked ? 'checked' : ''} />
                <span class="role-checkbox-fake"><i data-lucide="check"></i></span>
                <span class="role-checkbox-label">${esc(role)}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>

      <div class="modal-field">
        <div class="toggle-row">
          <div class="toggle-row-text">
            <p class="toggle-row-title">
              <i data-lucide="shield" style="width:14px;height:14px;color:var(--accent);"></i>
              Administrator
            </p>
            <p class="toggle-row-sub">Admins can manage members, events, rotation, and security.</p>
          </div>
          <div class="toggle-switch ${editing?.isAdmin ? 'on' : ''}" id="adminToggle">
            <input type="checkbox" id="memberIsAdmin" ${editing?.isAdmin ? 'checked' : ''} />
          </div>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-primary" id="confirmSaveMember">
        <i data-lucide="${editing ? 'save' : 'plus'}"></i>${editing ? 'Save changes' : 'Add member'}
      </button>
    </div>
  `;

  openModal(content, {
    onBind: (modal) => {
      $('#memberName', modal).focus();

      // Toggle behavior
      const adminToggle = $('#adminToggle', modal);
      const adminInput = $('#memberIsAdmin', modal);
      adminToggle.addEventListener('click', () => {
        adminInput.checked = !adminInput.checked;
        adminToggle.classList.toggle('on', adminInput.checked);
      });

      // Save
      $('#confirmSaveMember', modal).addEventListener('click', () => {
        const name = $('#memberName', modal).value.trim();
        const email = $('#memberEmail', modal).value.trim();
        const primaryRole = $('#memberPrimaryRole', modal).value.trim();
        const checkedRoles = $$('input[name="role"]:checked', modal);
        const roles = Array.from(checkedRoles).map(c => c.value);
        const isAdminFlag = $('#memberIsAdmin', modal).checked;

        if (!name) {
          showToast('Name is required', true);
          return;
        }

        if (editing) {
          const result = updateAccount(editing.id, {
            name, email, primaryRole, roles, isAdmin: isAdminFlag,
          });
          if (!result.ok) {
            showToast(friendlyError(result.reason), true);
            return;
          }
          closeModal();
          render();
          showToast(`Updated ${name}`);
        } else {
          const newAccount = addAccount({
            name, email, primaryRole, roles, isAdmin: isAdminFlag,
          });
          closeModal();
          render();
          showToast(`Added ${newAccount.name}`);
        }
      });
    },
  });
}

function openDeleteModal(memberId) {
  const member = accounts.find(a => a.id === memberId);
  if (!member) return;

  const assignments = getMemberAssignments(memberId);

  const content = `
    <div class="modal-head">
      <div class="modal-icon"><i data-lucide="user-x"></i></div>
      <div>
        <h3 class="modal-title">Delete ${esc(member.name)}?</h3>
        <p class="modal-sub">This will remove their account permanently. This action can't be undone (for now).</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      ${assignments.length > 0 ? `
        <div class="delete-impact">
          <p class="delete-impact-title">
            <i data-lucide="alert-triangle"></i>
            ${esc(member.name)} is assigned to ${assignments.length} event${assignments.length === 1 ? '' : 's'}:
          </p>
          <ul>
            ${assignments.map(a => `
              <li><strong>${esc(a.title)}</strong> — as ${esc(a.role)} on ${formatDate(a.date)}</li>
            `).join('')}
          </ul>
          <p style="font-size: 11px; color: #9F1239; margin-top: 8px;">They'll be removed from these events. The MD will be notified to reassign the roles.</p>
        </div>
      ` : `
        <p style="font-size: 13px; color: var(--text-2);">${esc(member.name)} isn't assigned to any upcoming events.</p>
      `}
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-danger" id="confirmDeleteMember">
        <i data-lucide="trash-2"></i>Yes, delete account
      </button>
    </div>
  `;

  openModal(content, {
    onBind: (modal) => {
      $('#confirmDeleteMember', modal).addEventListener('click', () => {
        const result = deleteAccount(memberId);
        if (!result.ok) {
          showToast(friendlyError(result.reason), true);
          return;
        }
        closeModal();
        render();
        if (result.removedFromEvents.length > 0) {
          showToast(`${member.name} deleted · removed from ${result.removedFromEvents.length} event(s)`);
        } else {
          showToast(`${member.name} deleted`);
        }
      });
    },
  });
}

function friendlyError(reason) {
  const map = {
    cannot_delete_self: "You can't delete your own account.",
    cannot_demote_self: "You can't remove your own admin status.",
    last_admin: "This is the last admin account. Promote another member to admin first.",
    not_found: 'Member not found.',
  };
  return map[reason] || 'Something went wrong.';
}

// ============================================================
// BINDINGS
// ============================================================
function bindAll() {
  // Add new member
  const addBtn = $('#addMemberBtn');
  if (addBtn) addBtn.addEventListener('click', () => openMemberFormModal(null));

  // Filter chips
  $$('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.filter = btn.dataset.filter;
      render();
    });
  });

  // Search input
  const searchInput = $('#membersSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      ui.search = e.target.value;
      // Re-render just the table
      const wrap = $('.members-table-wrap');
      const visible = getFilteredMembers();
      wrap.innerHTML = visible.length === 0 ? renderEmpty() : renderTable(visible);
      if (window.lucide) window.lucide.createIcons();
      // Re-bind row actions only
      bindRowActions();
    });
  }

  bindRowActions();
}

function bindRowActions() {
  $$('[data-edit-member]').forEach(btn => {
    btn.addEventListener('click', () => openMemberFormModal(btn.dataset.editMember));
  });
  $$('[data-delete-member]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.deleteMember));
  });
}

// ============================================================
// BOOT
// ============================================================
(async () => {
  await initShell();

  // If URL has a hash like #Some+Name, prefill the search filter
  if (location.hash) {
    const decoded = decodeURIComponent(location.hash.slice(1));
    if (decoded) ui.search = decoded;
    history.replaceState(null, '', location.pathname);
  }

  render();
  // Re-render when any Firestore data changes so all open tabs stay in sync.
  onDataChange(() => render());
})();
