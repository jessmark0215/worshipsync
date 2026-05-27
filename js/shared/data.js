// ============================================================
// WORSHIPSYNC · js/shared/data.js
// In-memory mirror of Firestore collections. The exported arrays
// (accounts, events, etc.) are populated by loadAllFromFirestore()
// before the first render of each page (see initShell).
//
// All mutation functions write through to Firestore via the helpers
// in firestore.js — localStorage is no longer used for app data.
// (localStorage still holds the dev test-admin toggle and a few
// transient signup-pending fields, since those are per-device only.)
// ============================================================

import { initFirestore, getColl, subscribeColl, setOne, updateOne, deleteOne, fireAndForget } from './firestore.js';
import { getAuthUser } from './auth.js';

// Format Date as YYYY-MM-DD using LOCAL time (not UTC).
function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a YYYY-MM-DD string as LOCAL midnight (not UTC).
export function parseLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

// ============================================================
// REHEARSAL FORMATTING
// ============================================================
// Rehearsals are stored as a structured pair (rehearsalDate, rehearsalTime)
// plus a derived display string `rehearsal` for backward compatibility with
// any code that reads it as text. The display string is always rebuilt on
// save from the structured fields — never hand-edited.

// Build the display string from a date + time. Mirrors the event-card
// formatting so rehearsals read like "Saturday, Dec 23 · 6:00 PM".
export function formatRehearsal(dateIso, time) {
  if (!dateIso && !time) return '';
  if (!dateIso) return time || '';
  const d = parseLocalDate(dateIso);
  if (!d) return time || '';
  const datePart = d.toLocaleDateString('en', {
    weekday: 'long', month: 'short', day: 'numeric'
  });
  return time ? `${datePart} · ${time}` : datePart;
}

// Best-effort parse of the legacy free-text rehearsal field so older events
// pre-populate the new date/time inputs when edited. Recognizes the format
// produced by formatRehearsal above ("Weekday, Mon DD · TIME") plus a few
// loose variants. Returns { date: 'YYYY-MM-DD' | '', time: 'H:MM AM' | '' }.
export function parseLegacyRehearsal(str) {
  if (!str || typeof str !== 'string') return { date: '', time: '' };
  const text = str.trim();
  if (!text) return { date: '', time: '' };

  // Split on " · " separator if present
  let datePart = text, timePart = '';
  if (text.includes(' · ')) {
    [datePart, timePart] = text.split(' · ').map(s => s.trim());
  } else {
    // Otherwise pull a trailing time off the end (e.g. "Saturday, Dec 23 6:00 PM")
    const m = text.match(/^(.*?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*$/i);
    if (m) { datePart = m[1].trim(); timePart = m[2].trim(); }
  }

  // Try parsing the date part as a natural date. We tack on the current year
  // if no year is present, so "Saturday, Dec 23" lands in this year.
  let dateIso = '';
  const cleaned = datePart.replace(/^[A-Za-z]+,\s*/, ''); // drop leading "Saturday, "
  const withYear = /\b\d{4}\b/.test(cleaned) ? cleaned : `${cleaned} ${new Date().getFullYear()}`;
  const parsed = new Date(withYear);
  if (!isNaN(parsed.getTime())) dateIso = toLocalISODate(parsed);

  return { date: dateIso, time: timePart || '' };
}

// ============================================================
// SEED DATA — minimal. Fake fixtures removed.
// ============================================================

// Pre-defined admin account — every user has this in their accounts list
// so admin features remain testable. Can be promoted/demoted later.
const seedAdminAccount = {
  id: 'u_admin',
  name: 'Admin Pastor',
  firstName: 'Admin',
  email: 'admin@worshipsync.app',
  initials: 'AP',
  color: 'ink',
  primaryRole: 'Administrator',
  roles: [],
  isAdmin: true,
  isSeedAdmin: true,
  joinedAt: '2024-01-01',
};

const seedVerses = [
  { text: 'Sing to the Lord a new song; sing to the Lord, all the earth.', ref: 'Psalm 96:1' },
  { text: 'Let everything that has breath praise the Lord.', ref: 'Psalm 150:6' },
  { text: 'Speaking to one another with psalms, hymns, and songs from the Spirit.', ref: 'Ephesians 5:19' },
  { text: 'I will sing of the Lord\'s great love forever; with my mouth I will make your faithfulness known.', ref: 'Psalm 89:1' },
  { text: 'Shout for joy to the Lord, all the earth, burst into jubilant song with music.', ref: 'Psalm 98:4' },
  { text: 'Sing and make music from your heart to the Lord.', ref: 'Ephesians 5:19' },
  { text: 'My heart is steadfast, O God; I will sing and make music with all my soul.', ref: 'Psalm 108:1' },
  { text: 'Praise the Lord with the harp; make music to him on the ten-stringed lyre.', ref: 'Psalm 33:2' },
  { text: 'I will praise you, Lord, with all my heart; I will tell of all your wonderful deeds.', ref: 'Psalm 9:1' },
  { text: 'Worship the Lord with gladness; come before him with joyful songs.', ref: 'Psalm 100:2' },
  { text: 'Let us come before him with thanksgiving and extol him with music and song.', ref: 'Psalm 95:2' },
  { text: 'Praise him with the sounding of the trumpet, praise him with the harp and lyre.', ref: 'Psalm 150:3' },
  { text: 'The Lord is my strength and my song; he has become my salvation.', ref: 'Exodus 15:2' },
  { text: 'Sing praises to God, sing praises; sing praises to our King, sing praises.', ref: 'Psalm 47:6' },
  { text: 'Praise the Lord, my soul; all my inmost being, praise his holy name.', ref: 'Psalm 103:1' },
];

// ============================================================
// PER-USER STORAGE
// ============================================================

// In-memory state. Empty until loadAllFromFirestore() runs.
const _state = {
  accounts: [],
  events: [],
  templates: [],
  archive: [],
  notifications: [],
  analytics: { sessions: [], pageVisits: {}, online: {} },
};

let _hasLoaded = false;
// Track active onSnapshot unsubscribe functions so we can clean up if needed
const _unsubscribers = [];

// ---- Change-listener registry ----
// Pages register a callback via onDataChange(fn). When any collection
// snapshot fires the callback is invoked so pages can re-render without
// the user having to refresh.
const _changeListeners = new Set();

export function onDataChange(fn) {
  _changeListeners.add(fn);
  // Return a cleanup function
  return () => _changeListeners.delete(fn);
}

function _notifyChange() {
  for (const fn of _changeListeners) {
    try { fn(); } catch (e) { console.error('[data] change listener threw:', e); }
  }
}

// Loads all collections from Firestore and sets up real-time listeners.
// Must be awaited before any page renders. Idempotent — subsequent calls
// return immediately since listeners are already active.
export async function loadAllFromFirestore() {
  if (_hasLoaded) return;
  await initFirestore();

  // --- Initial fetch: get all data before first render ---
  const [accs, evs, tpls, arch, notifs] = await Promise.all([
    getColl('accounts').catch(() => []),
    getColl('events').catch(() => []),
    getColl('templates').catch(() => []),
    getColl('archive').catch(() => []),
    getColl('notifications').catch(() => []),
  ]);

  evs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  notifs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  _state.accounts.length = 0; _state.accounts.push(...accs);
  _state.events.length = 0;   _state.events.push(...evs);
  _state.templates.length = 0; _state.templates.push(...tpls);
  _state.archive.length = 0;   _state.archive.push(...arch);
  _state.notifications.length = 0; _state.notifications.push(...notifs);

  // Bootstrap: make sure the seed admin exists in the shared accounts coll
  if (!_state.accounts.find(a => a.id === 'u_admin')) {
    const seed = { ...seedAdminAccount };
    _state.accounts.push(seed);
    fireAndForget(setOne('accounts', 'u_admin', seed), 'bootstrap seed admin');
  }

  rebuildMemberDirectory();
  refreshCurrentUser();
  _hasLoaded = true;

  // --- Real-time listeners: keep in-memory state in sync ---
  // These fire immediately with current data (which we already have from
  // the initial fetch above, so we skip the very first emission using the
  // _hasLoaded flag to avoid a redundant double-render on page load).
  let _firstAccounts = true;
  let _firstEvents = true;
  let _firstTemplates = true;
  let _firstArchive = true;
  let _firstNotifs = true;

  _unsubscribers.push(await subscribeColl('accounts', docs => {
    if (_firstAccounts) { _firstAccounts = false; return; }
    _state.accounts.length = 0; _state.accounts.push(...docs);
    rebuildMemberDirectory();
    refreshCurrentUser();
    _notifyChange();
  }));

  _unsubscribers.push(await subscribeColl('events', docs => {
    if (_firstEvents) { _firstEvents = false; return; }
    docs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    _state.events.length = 0; _state.events.push(...docs);
    _notifyChange();
  }));

  _unsubscribers.push(await subscribeColl('templates', docs => {
    if (_firstTemplates) { _firstTemplates = false; return; }
    _state.templates.length = 0; _state.templates.push(...docs);
    _notifyChange();
  }));

  _unsubscribers.push(await subscribeColl('archive', docs => {
    if (_firstArchive) { _firstArchive = false; return; }
    _state.archive.length = 0; _state.archive.push(...docs);
    _notifyChange();
  }));

  _unsubscribers.push(await subscribeColl('notifications', docs => {
    if (_firstNotifs) { _firstNotifs = false; return; }
    docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    _state.notifications.length = 0; _state.notifications.push(...docs);
    _notifyChange();
  }));
}

// ============================================================
// CURRENT USER
// ============================================================
// Active UID = Firebase user's uid. Read live from the auth module so we
// don't have to mirror it into localStorage.
const DEV_SWITCH_KEY = 'worshipsync.devSwitch';  // local-only test-admin toggle

function getActiveUid() {
  // Prefer the live Firebase auth user; fall back to a localStorage probe
  // (needed during the brief window between page load and auth init).
  try {
    const u = getAuthUser();
    if (u?.uid) return u.uid;
  } catch (_) {}
  // Probe Firebase Auth's persisted user
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('firebase:authUser:')) {
        const val = JSON.parse(localStorage.getItem(key));
        if (val?.uid) return val.uid;
      }
    }
  } catch (_) {}
  return '_anon';
}

function getInAppUserId() {
  try {
    const dev = localStorage.getItem(DEV_SWITCH_KEY);
    if (dev) return dev;
  } catch (_) {}
  return getActiveUid();
}

function setInAppUserId(id) {
  try {
    if (id && id !== getActiveUid()) localStorage.setItem(DEV_SWITCH_KEY, id);
    else localStorage.removeItem(DEV_SWITCH_KEY);
  } catch (_) {}
}

// Re-resolve current user from in-memory state. Called after loadAll(),
// ensureUserAccount(), or dev-switch toggle.
function refreshCurrentUser() {
  _currentUser = _state.accounts.find(a => a.id === getInAppUserId())
    || null;
  currentUser = _currentUser;  // re-export via live binding
}

let _currentUser = null;

// ============================================================
// PUBLIC EXPORTS
// ============================================================
// NOTE: `currentUser` is exported as `let` for live binding — when
// refreshCurrentUser() re-assigns it, importers see the new value
// (provided they access it as `currentUser.name`, not destructured).
export let currentUser = _currentUser;
export const accounts = _state.accounts;
export const events = _state.events;
export const notifications = _state.notifications;
export const verses = seedVerses;
export const analytics = _state.analytics;
export const templates = _state.templates;
export const archive = _state.archive;

// Derived: musician picker reads `memberDirectory` — anyone with at least
// one instrument role. (Admin-only accounts without roles are excluded.)
// We rebuild this array in place whenever accounts change.
export const memberDirectory = [];
function rebuildMemberDirectory() {
  memberDirectory.length = 0;
  for (const a of _state.accounts) {
    if (Array.isArray(a.roles) && a.roles.length > 0) {
      memberDirectory.push(a);
    }
  }
}

// ============================================================
// AUTH / ACCOUNT HELPERS
// ============================================================

// Switch active user (dev/testing). Reloads page.
export function switchUser(userId) {
  if (!_state.accounts.find(a => a.id === userId)) return false;
  setInAppUserId(userId);
  location.reload();
  return true;
}

// Returns true if currently viewing as the test admin (devSwitch is active)
export function isViewingAsTestAdmin() {
  return _currentUser?.id === 'u_admin' && getActiveUid() !== 'u_admin';
}

// Toggle between the real user and the seed admin (for testing).
// If already viewing as test admin, switch back to the real user.
export function toggleTestAdmin() {
  const realUid = getActiveUid();
  if (isViewingAsTestAdmin()) {
    setInAppUserId(realUid);
  } else {
    setInAppUserId('u_admin');
  }
  location.reload();
}

// Called by auth flow on first login: ensure the Firebase user has a
// matching account record in our data store.
// `profile` is { name, email, roles } captured at signup time.
// Returns { account, created } where `created === true` if a brand-new account
// was added (caller may want to reload the page so `currentUser` refreshes).
export function ensureUserAccount(uid, profile = {}) {
  let created = false;
  let acc = _state.accounts.find(a => a.id === uid);
  if (!acc) {
    const name = profile.name || profile.email?.split('@')[0] || 'New user';
    const parts = name.split(' ');
    acc = {
      id: uid,
      name,
      firstName: parts[0] || name,
      email: profile.email || '',
      initials: parts.map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'U',
      color: pickColorFromUid(uid),
      primaryRole: profile.roles?.[0] || '',
      roles: Array.isArray(profile.roles) ? profile.roles : [],
      isAdmin: false,
      isSeedAdmin: false,
      joinedAt: toLocalISODate(new Date()),
    };
    _state.accounts.push(acc);
    rebuildMemberDirectory();
    persistAccount(acc.id);
    refreshCurrentUser();
    created = true;
  } else {
    // Update name/email/roles if they changed at signup
    let dirty = false;
    if (profile.name && acc.name !== profile.name) { acc.name = profile.name; dirty = true; }
    if (profile.email && acc.email !== profile.email) { acc.email = profile.email; dirty = true; }
    if (profile.roles && profile.roles.length && !arraysEqual(acc.roles, profile.roles)) {
      acc.roles = profile.roles;
      acc.primaryRole = profile.roles[0] || acc.primaryRole;
      dirty = true;
    }
    if (dirty) {
      rebuildMemberDirectory();
      persistAccount(acc.id);
    }
    refreshCurrentUser();
  }
  return { account: acc, created };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function pickColorFromUid(uid) {
  const colors = ['green', 'amber', 'rose', 'blue', 'teal', 'stone'];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

// Called by auth.js on sign-out so the next user gets their own data
export function clearActiveUid() {
  try {
    localStorage.removeItem(DEV_SWITCH_KEY);
  } catch (_) {}
}

export function isAdmin() {
  return !!currentUser?.isAdmin;
}

// Update the current user's own profile (name, roles).
// Used by Settings page so any user can fix their own roles after signup.
export async function updateMyProfile({ name, roles }) {
  if (!currentUser) return { ok: false, reason: 'not_signed_in' };
  const acc = _state.accounts.find(a => a.id === currentUser.id);
  if (!acc) return { ok: false, reason: 'not_found' };

  // Update fields locally
  if (name && name.trim()) {
    acc.name = name.trim();
    const parts = acc.name.split(' ');
    acc.firstName = parts[0] || acc.name;
    acc.initials = parts.map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'U';
  }
  if (Array.isArray(roles)) {
    acc.roles = roles;
    acc.primaryRole = roles[0] || '';
  }
  rebuildMemberDirectory();
  // Write to Firestore and await so the user knows it succeeded
  try {
    await setOne('accounts', acc.id, acc);
    return { ok: true, account: acc };
  } catch (e) {
    return { ok: false, reason: 'firestore_write_failed', error: e.message || String(e) };
  }
}

// Add a new account. Defaults: not admin, no roles.
export function addAccount(account) {
  const id = account.id || 'u_' + Math.random().toString(36).slice(2, 9);
  const newAccount = {
    id,
    isAdmin: false,
    isSeedAdmin: false,
    roles: [],
    color: 'green',
    joinedAt: toLocalISODate(new Date()),
    ...account,
  };
  if (!newAccount.firstName) newAccount.firstName = newAccount.name?.split(' ')[0] || '';
  if (!newAccount.initials) {
    newAccount.initials = newAccount.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  }
  _state.accounts.push(newAccount);
  rebuildMemberDirectory();
  persistAccount(newAccount.id);
  return newAccount;
}

// Update an existing account. Returns false if attempting unsafe edits.
export function updateAccount(userId, patch) {
  const acc = _state.accounts.find(a => a.id === userId);
  if (!acc) return { ok: false, reason: 'not_found' };

  // Safety: don't allow removing your own admin
  if (acc.id === currentUser.id && patch.isAdmin === false && acc.isAdmin) {
    return { ok: false, reason: 'cannot_demote_self' };
  }

  // Safety: don't allow demoting the last remaining admin
  if (patch.isAdmin === false && acc.isAdmin) {
    const adminCount = _state.accounts.filter(a => a.isAdmin).length;
    if (adminCount <= 1) {
      return { ok: false, reason: 'last_admin' };
    }
  }

  Object.assign(acc, patch);
  // Recompute initials if name changed
  if (patch.name && !patch.initials) {
    acc.initials = patch.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  }
  rebuildMemberDirectory();
  persistAccount(acc.id);
  return { ok: true, account: acc };
}

// Delete an account with safeguards
export function deleteAccount(userId) {
  const idx = _state.accounts.findIndex(a => a.id === userId);
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const acc = _state.accounts[idx];

  // Safety: can't delete yourself
  if (acc.id === currentUser.id) {
    return { ok: false, reason: 'cannot_delete_self' };
  }
  // Safety: can't delete the last admin
  if (acc.isAdmin) {
    const adminCount = _state.accounts.filter(a => a.isAdmin).length;
    if (adminCount <= 1) {
      return { ok: false, reason: 'last_admin' };
    }
  }

  // Remove them from any upcoming event teams too
  const removedFromEvents = [];
  const eventsToWrite = [];
  for (const ev of _state.events) {
    const before = ev.team.length;
    ev.team = ev.team.filter(t => t.name !== acc.name);
    if (ev.team.length !== before) {
      removedFromEvents.push(ev.title);
      eventsToWrite.push(ev.id);
    }
  }

  _state.accounts.splice(idx, 1);
  rebuildMemberDirectory();
  fireAndForget(deleteOne('accounts', acc.id), 'delete account');
  eventsToWrite.forEach(id => persistEvent(id));
  return { ok: true, removedFromEvents };
}

// Lookup which events a member is assigned to (for delete preview)
export function getMemberAssignments(userId) {
  const acc = _state.accounts.find(a => a.id === userId);
  if (!acc) return [];
  return _state.events
    .filter(e => e.team.some(t => t.userId === userId || t.name === acc.name))
    .map(e => {
      const entry = e.team.find(t => t.userId === userId || t.name === acc.name);
      return { id: e.id, title: e.title, date: e.date, role: entry?.role };
    });
}

// Return the events the given user is assigned to.
// Each event gets `yourRole` and `yourStatus` derived from their team entry.
export function getEventsForUser(userId) {
  const result = [];
  for (const e of _state.events) {
    // Collect ALL roles this user has on the event (e.g. both MD and Worship Leader)
    const entries = e.team.filter(t => t.userId === userId);
    if (!entries.length) continue;
    for (const entry of entries) {
      result.push({
        ...e,
        yourRole: entry.role,
        yourStatus: entry.status || 'pending',
        // Unique key so the UI can distinguish the two role-cards for the same event
        roleKey: `${e.id}|${entry.role}`,
      });
    }
  }
  return result;
}

// Update the status of the current user on an event (accept/decline).
// Pass `role` when the user holds multiple roles on the same event so the
// correct team entry is updated; omit to fall back to the first match.
export function setMyEventStatus(eventId, newStatus, role) {
  const ev = _state.events.find(e => e.id === eventId);
  if (!ev) return { ok: false, reason: 'not_found' };
  const entry = role
    ? ev.team.find(t => t.userId === currentUser.id && t.role === role)
    : ev.team.find(t => t.userId === currentUser.id);
  if (!entry) return { ok: false, reason: 'not_on_team' };
  entry.status = newStatus;
  persistEvent(ev.id);
  return { ok: true, event: ev, entry };
}

export function setAdminFlag(userId, isAdmin) {
  return updateAccount(userId, { isAdmin });
}

// All instrument/team roles a member can sign up for.
// These are what the Members page exposes as checkbox options.
export const INSTRUMENT_ROLES = [
  'Music Director',
  'Worship Leader',
  'Guitarist',
  'Bassist',
  'Drummer',
  'Keys',
  'Backup Singer',
  'Sound Man',
];

// Roles MD CANNOT touch (admin-only)
export const PROTECTED_ROLES = ['Music Director'];

// Roles MD CAN assign
export const ASSIGNABLE_ROLES = [
  'Worship Leader',
  'Guitar 1', 'Guitar 2', 'Guitar 3',
  'Bassist',
  'Drummer',
  'Keys', 'Keys 2',
  'Backup Singer', 'Backup Singer 2', 'Backup Singer 3',
  'Sound Man',
];

// Map an event role slot (e.g. "Guitar 1", "Keys 2", "Backup Singer 3")
// to the directory role(s) that qualify.
// Directory uses "Guitarist" / "Keys" / "Backup Singer" etc.
const ROLE_MAP = {
  'Music Director': ['Music Director'],
  'Worship Leader': ['Worship Leader'],
  'Bassist': ['Bassist'],
  'Drummer': ['Drummer'],
  'Sound Man': ['Sound Man'],
  // Numbered variants normalize to the base instrument
  'Guitar 1': ['Guitarist'], 'Guitar 2': ['Guitarist'], 'Guitar 3': ['Guitarist'],
  'Guitarist': ['Guitarist'],
  'Keys': ['Keys'], 'Keys 2': ['Keys'],
  'Backup Singer': ['Backup Singer'],
  'Backup Singer 2': ['Backup Singer'],
  'Backup Singer 3': ['Backup Singer'],
};

// Check whether a directory member has the role required by an event slot.
// E.g. eventRole "Guitar 2" → person.roles must contain "Guitarist".
// If the eventRole isn't recognized (custom role), we do a case-insensitive substring match.
export function memberFitsRole(person, eventRole) {
  if (!eventRole) return true;
  const required = ROLE_MAP[eventRole];
  if (required) {
    return person.roles.some(r => required.includes(r));
  }
  // Custom role — relaxed substring match
  const target = eventRole.toLowerCase().replace(/\s\d+$/, '').trim();
  return person.roles.some(r => r.toLowerCase().includes(target));
}

// ============================================================
// FIRESTORE WRITE HELPERS
// ============================================================
// Each helper updates exactly the doc that just changed.
// All writes are fire-and-forget (UI doesn't wait for Firestore).

export function persistAccount(id) {
  const a = _state.accounts.find(x => x.id === id);
  if (a) fireAndForget(setOne('accounts', a.id, a), 'persist account');
}
export function persistEvent(id) {
  const e = _state.events.find(x => x.id === id);
  if (e) fireAndForget(setOne('events', e.id, e), 'persist event');
}
export function persistTemplate(id) {
  const t = _state.templates.find(x => x.id === id);
  if (t) fireAndForget(setOne('templates', t.id, t), 'persist template');
}
export function persistNotification(id) {
  const n = _state.notifications.find(x => x.id === id);
  if (n) fireAndForget(setOne('notifications', n.id, n), 'persist notification');
}
function persistArchive(id) {
  const a = _state.archive.find(x => x.id === id);
  if (a) fireAndForget(setOne('archive', a.id, a), 'persist archive');
}

// Kept for backward compatibility — many older mutation paths call persist().
// In the new model, individual mutations write through directly, so this is
// a no-op. It exists so we don't have to find/replace every callsite.
export function persist() {
  // intentionally empty
}

// ============================================================
// NOTIFICATION HELPERS
// ============================================================

// Add a new notification to the top of the list.
// forUserId: target a specific user (omit for "current user" / global).
export function pushNotification({ eventId, icon, tone, text, forUserId }) {
  const n = {
    id: 'n_' + Math.random().toString(36).slice(2, 9),
    eventId: eventId ?? null,
    forUserId: forUserId ?? null,
    icon: icon || 'bell',
    tone: tone || 'accent',
    text,
    createdAt: Date.now(),
    unread: true,
  };
  notifications.unshift(n);
  // Cap at 50 (since each user only sees their own subset)
  if (notifications.length > 50) notifications.length = 50;
  persistNotification(n.id);
}

export function markNotificationRead(id) {
  const n = notifications.find(x => x.id === id);
  if (n && n.unread) {
    n.unread = false;
    persistNotification(id);
    return true;
  }
  return false;
}

export function markAllNotificationsRead() {
  let changed = false;
  const toWrite = [];
  getMyNotifications().forEach(n => {
    if (n.unread) {
      n.unread = false;
      changed = true;
      toWrite.push(n.id);
    }
  });
  toWrite.forEach(id => persistNotification(id));
  return changed;
}

export function getUnreadNotificationCount() {
  return getMyNotifications().filter(n => n.unread).length;
}

// Notifications visible to the current user: untargeted OR targeted at them.
export function getMyNotifications() {
  return notifications.filter(n => !n.forUserId || n.forUserId === currentUser.id);
}

// ============================================================
// EVENT HELPERS (admin)
// ============================================================

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(idx) {
  return WEEKDAY_NAMES[idx] ?? '';
}

// Categorize events into upcoming, recent past (< 3mo), cold (3-6mo).
// Also surfaces archived items from the dedicated archive array.
export function categorizeEvents() {
  const now = new Date();
  const THREE_MO = 90 * 24 * 60 * 60 * 1000;
  const upcoming = [];
  const recentPast = [];
  const cold = [];

  for (const ev of _state.events) {
    const evDate = new Date(ev.date);
    const diff = now - evDate;
    if (diff < 0) {
      upcoming.push(ev);
    } else if (diff < THREE_MO) {
      recentPast.push(ev);
    } else {
      cold.push(ev);
    }
  }

  // Sort: upcoming ascending, past descending
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  recentPast.sort((a, b) => new Date(b.date) - new Date(a.date));
  cold.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    upcoming,
    recentPast,
    cold: [...cold, ..._state.archive],
  };
}

// Build a fresh event object with sensible defaults
function newEventShell({ id, title, date, time, location, isRecurring = false, templateId = null }) {
  return {
    id: id || nextEventId(),
    title,
    date,
    time,
    location: location || 'Main Sanctuary',
    yourRole: '', // not relevant from admin view; filled per user later
    status: 'pending',
    recurring: isRecurring,
    templateId,
    rehearsal: '',
    rehearsalDate: '',
    rehearsalTime: '',
    setlist: [],
    team: [],
  };
}

function nextEventId() {
  const maxId = _state.events.reduce((m, e) => Math.max(m, typeof e.id === 'number' ? e.id : 0), 0);
  return maxId + 1;
}

// Add a manual (one-off) event
export function addOneOffEvent({ title, date, time, location, rehearsal, rehearsalDate, rehearsalTime, mdName, worshipLeaderName }) {
  const ev = newEventShell({ title, date, time, location, isRecurring: false });
  ev.rehearsal = rehearsal || '';
  ev.rehearsalDate = rehearsalDate || '';
  ev.rehearsalTime = rehearsalTime || '';

  // Push event first so notifications can reference its id
  _state.events.push(ev);

  // Pre-fill MD + WL if names provided (lookup full member record)
  if (mdName) {
    const acc = _state.accounts.find(a => a.name === mdName);
    if (acc) {
      ev.team.push({
        role: 'Music Director',
        userId: acc.id,
        name: acc.name,
        initials: acc.initials,
        color: acc.color,
        status: 'pending',
      });
      pushNotification({
        eventId: ev.id,
        forUserId: acc.id,
        icon: 'crown',
        tone: 'accent',
        text: `You're assigned as <strong>Music Director</strong> for ${esc(ev.title)}.`,
      });
    }
  }
  if (worshipLeaderName) {
    const acc = _state.accounts.find(a => a.name === worshipLeaderName);
    if (acc) {
      ev.team.push({
        role: 'Worship Leader',
        userId: acc.id,
        name: acc.name,
        initials: acc.initials,
        color: acc.color,
        status: 'pending',
      });
      pushNotification({
        eventId: ev.id,
        forUserId: acc.id,
        icon: 'mic-2',
        tone: 'accent',
        text: `You're assigned as <strong>Worship Leader</strong> for ${esc(ev.title)}.`,
      });
    }
  }

  persistEvent(ev.id);
  return ev;
}

// Update any event field (admin override)
export function updateEvent(eventId, patch) {
  const ev = _state.events.find(e => e.id === eventId);
  if (!ev) return { ok: false, reason: 'not_found' };
  Object.assign(ev, patch);
  persistEvent(ev.id);
  return { ok: true, event: ev };
}

// Delete an event entirely (admin only)
export function deleteEvent(eventId) {
  const idx = _state.events.findIndex(e => e.id === eventId);
  if (idx < 0) {
    // Also try archive
    const aIdx = _state.archive.findIndex(e => e.id === eventId);
    if (aIdx < 0) return { ok: false, reason: 'not_found' };
    const removed = _state.archive.splice(aIdx, 1)[0];
    fireAndForget(deleteOne('archive', removed.id), 'delete archive');
    return { ok: true, event: removed, fromArchive: true };
  }
  const removed = _state.events.splice(idx, 1)[0];
  fireAndForget(deleteOne('events', removed.id), 'delete event');
  return { ok: true, event: removed };
}

// Move an old event to the cold archive (admin choice; will also happen automatically later)
export function archiveEvent(eventId) {
  const idx = _state.events.findIndex(e => e.id === eventId);
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const ev = _state.events.splice(idx, 1)[0];
  _state.archive.push(ev);
  persistArchive(ev.id);
  fireAndForget(deleteOne('events', ev.id), 'archive: delete event');
  return { ok: true, event: ev };
}

// ============================================================
// RECURRING TEMPLATE HELPERS
// ============================================================

export function addTemplate({ title, weekday, time, location, rehearsalDayOffset, rehearsalTime, mdRotation, wlRotation }) {
  const t = {
    id: 't_' + Math.random().toString(36).slice(2, 9),
    title,
    weekday: parseInt(weekday),
    time,
    location: location || 'Main Sanctuary',
    rehearsalDayOffset: rehearsalDayOffset ?? -1,
    rehearsalTime: rehearsalTime || '6:00 PM',
    active: true,
    mdRotation: mdRotation || { order: [], nextIndex: 0 },
    wlRotation: wlRotation || { order: [], nextIndex: 0 },
  };
  _state.templates.push(t);
  persistTemplate(t.id);
  return t;
}

export function updateTemplate(templateId, patch) {
  const t = _state.templates.find(x => x.id === templateId);
  if (!t) return { ok: false, reason: 'not_found' };
  Object.assign(t, patch);
  if (patch.weekday !== undefined) t.weekday = parseInt(patch.weekday);
  persistTemplate(t.id);
  return { ok: true, template: t };
}

export function deleteTemplate(templateId) {
  const idx = _state.templates.findIndex(x => x.id === templateId);
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const removed = _state.templates.splice(idx, 1)[0];
  fireAndForget(deleteOne('templates', removed.id), 'delete template');
  return { ok: true, template: removed };
}

// Compute the next N occurrence dates for a template, starting today
export function nextOccurrences(template, count = 4) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = template.weekday; // 0..6
  const results = [];
  // Find next occurrence of weekday
  let date = new Date(today);
  while (date.getDay() !== targetDay) {
    date.setDate(date.getDate() + 1);
  }
  for (let i = 0; i < count; i++) {
    results.push(new Date(date));
    date.setDate(date.getDate() + 7);
  }
  return results;
}

// Pull the next user from a template's rotation and advance the pointer.
function _consumeRotation(template, kind /* 'md' | 'wl' */) {
  const rot = kind === 'md' ? template.mdRotation : template.wlRotation;
  if (!rot || !Array.isArray(rot.order) || rot.order.length === 0) return null;
  // Auto-prune missing users
  const validIds = new Set(_state.accounts.map(a => a.id));
  rot.order = rot.order.filter(id => validIds.has(id));
  if (rot.order.length === 0) return null;
  if (rot.nextIndex >= rot.order.length) rot.nextIndex = 0;
  const id = rot.order[rot.nextIndex];
  const user = _state.accounts.find(a => a.id === id);
  rot.nextIndex = (rot.nextIndex + 1) % rot.order.length;
  return user;
}

// Generate concrete event instances from a template (admin "Generate next N" action).
// Skips dates that already have an event from this template.
// Auto-fills Music Director and Worship Leader using the template's rotation.
export function generateFromTemplate(templateId, count = 4) {
  const t = _state.templates.find(x => x.id === templateId);
  if (!t) return { ok: false, reason: 'not_found' };

  const dates = nextOccurrences(t, count);
  const created = [];
  for (const d of dates) {
    const iso = toLocalISODate(d);
    // Skip if event already exists for this template+date
    const exists = _state.events.some(e => e.templateId === t.id && e.date === iso);
    if (exists) continue;

    // Rehearsal date = event date + offset
    const rehearsal = new Date(d);
    rehearsal.setDate(rehearsal.getDate() + (t.rehearsalDayOffset ?? -1));
    const rehearsalIso = toLocalISODate(rehearsal);
    const rehearsalStr = rehearsal.toLocaleString('en', { weekday: 'long', month: 'short', day: 'numeric' }) + ' · ' + t.rehearsalTime;

    const ev = newEventShell({
      title: t.title,
      date: iso,
      time: t.time,
      location: t.location,
      isRecurring: true,
      templateId: t.id,
    });
    ev.rehearsal = rehearsalStr;
    ev.rehearsalDate = rehearsalIso;
    ev.rehearsalTime = t.rehearsalTime || '';

    // Auto-fill MD + WL from rotation, each starting as 'pending' for them.
    const mdUser = _consumeRotation(t, 'md');
    if (mdUser) {
      ev.team.push({
        role: 'Music Director',
        userId: mdUser.id,
        name: mdUser.name,
        initials: mdUser.initials,
        color: mdUser.color,
        status: 'pending',
      });
      pushNotification({
        eventId: ev.id,
        forUserId: mdUser.id,
        icon: 'crown',
        tone: 'accent',
        text: `You're assigned as <strong>Music Director</strong> for ${esc(ev.title)} on ${rehearsal.toLocaleString('en', { month: 'short', day: 'numeric' })}.`,
      });
    }
    const wlUser = _consumeRotation(t, 'wl');
    if (wlUser) {
      ev.team.push({
        role: 'Worship Leader',
        userId: wlUser.id,
        name: wlUser.name,
        initials: wlUser.initials,
        color: wlUser.color,
        status: 'pending',
      });
      pushNotification({
        eventId: ev.id,
        forUserId: wlUser.id,
        icon: 'mic-2',
        tone: 'accent',
        text: `You're assigned as <strong>Worship Leader</strong> for ${esc(ev.title)} on ${d.toLocaleString('en', { month: 'short', day: 'numeric' })}.`,
      });
    }

    _state.events.push(ev);
    created.push(ev);
    persistEvent(ev.id);
  }
  // Rotation pointer changed during generation — write template too
  persistTemplate(templateId);
  return { ok: true, created };
}

// Tiny escape for use inside this file (avoid circular import on ui.js)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Reset client-side state (does NOT delete Firestore data — for that, use
// the Firebase Console). Useful when testing the dev test-admin toggle.
export function resetState() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('worshipsync.'))
      .forEach(k => localStorage.removeItem(k));
  } catch (_) {}
  location.reload();
}

// Expose reset for console debugging
if (typeof window !== 'undefined') {
  window.worshipSyncReset = resetState;
}

// ============================================================
// VERSE OF THE DAY
// ============================================================
export function getTodayVerse() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return seedVerses[dayOfYear % seedVerses.length];
}
