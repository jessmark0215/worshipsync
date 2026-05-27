// ============================================================
// WORSHIPSYNC · js/shared/analytics.js
// Tracks: session duration, page visits, online presence.
// Persists to localStorage (later: ship to Firebase).
// ============================================================

import { currentUser, analytics, persist } from './data.js';

const HEARTBEAT_INTERVAL_MS = 30_000;  // 30s
const ONLINE_THRESHOLD_MS = 90_000;    // 90s = considered online
let _sessionStart = null;
let _heartbeatTimer = null;
let _currentPage = null;

function getCurrentPageId() {
  const path = location.pathname.split('/').pop() || 'index.html';
  const name = path.replace('.html', '');
  if (name === 'index' || name === '') return 'my-schedules';
  return name;
}

export function initAnalytics() {
  if (!currentUser) return;
  _sessionStart = Date.now();
  _currentPage = getCurrentPageId();

  // Record page visit
  if (!analytics.pageVisits[currentUser.id]) {
    analytics.pageVisits[currentUser.id] = {};
  }
  if (!analytics.pageVisits[currentUser.id][_currentPage]) {
    analytics.pageVisits[currentUser.id][_currentPage] = 0;
  }
  analytics.pageVisits[currentUser.id][_currentPage]++;

  // Mark online
  pulse();

  // Heartbeat
  _heartbeatTimer = setInterval(pulse, HEARTBEAT_INTERVAL_MS);

  // On page unload — log session
  window.addEventListener('beforeunload', flushSession);

  // Log a tab visibility change too
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pulse();
  });
}

function pulse() {
  if (!currentUser) return;
  analytics.online[currentUser.id] = Date.now();
  // Lightweight — persist every heartbeat
  persist();
}

function flushSession() {
  if (!currentUser || _sessionStart === null) return;
  const duration = Date.now() - _sessionStart;
  analytics.sessions.push({
    userId: currentUser.id,
    page: _currentPage,
    startedAt: _sessionStart,
    durationMs: duration,
  });
  // Keep only last 200 sessions to avoid bloat
  if (analytics.sessions.length > 200) {
    analytics.sessions = analytics.sessions.slice(-200);
  }
  persist();
  clearInterval(_heartbeatTimer);
}

// ============================================================
// PUBLIC QUERIES (used by admin dashboard)
// ============================================================

// Is this user currently online (heartbeat within threshold)?
export function isOnline(userId) {
  const last = analytics.online[userId];
  if (!last) return false;
  return (Date.now() - last) < ONLINE_THRESHOLD_MS;
}

// All currently-online user IDs
export function getOnlineUsers() {
  const now = Date.now();
  return Object.entries(analytics.online)
    .filter(([_, t]) => (now - t) < ONLINE_THRESHOLD_MS)
    .map(([id]) => id);
}

// Total session time for a user across all sessions (ms)
export function getTotalTimeMs(userId) {
  return analytics.sessions
    .filter(s => s.userId === userId)
    .reduce((sum, s) => sum + s.durationMs, 0);
}

// Number of sessions for a user
export function getSessionCount(userId) {
  return analytics.sessions.filter(s => s.userId === userId).length;
}

// Page visits — total across the app
export function getTotalPageVisits() {
  let total = 0;
  for (const userId in analytics.pageVisits) {
    for (const page in analytics.pageVisits[userId]) {
      total += analytics.pageVisits[userId][page];
    }
  }
  return total;
}

// Sessions in the last N hours
export function getRecentSessions(hoursAgo = 24) {
  const cutoff = Date.now() - (hoursAgo * 60 * 60 * 1000);
  return analytics.sessions.filter(s => s.startedAt >= cutoff);
}

// Format ms as readable duration
export function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hrs = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

// Relative time helper
export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
