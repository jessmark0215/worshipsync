// ============================================================
// WORSHIPSYNC · js/shared/storage.js
// Storage wrapper backed by SUPABASE STORAGE (free tier, no card).
//
// Uses the Supabase Storage REST API directly (no SDK) to keep the
// app build-free. The public interface is unchanged from the old
// Firebase version — uploadFile / deleteFile / MAX_UPLOAD_BYTES /
// formatBytes — so studio.js needs no changes.
//
// SECURITY MODEL (chosen: "simple / app-enforced"):
//   Uploads go up with the public anon key. The "only the Music
//   Director can upload" rule is enforced in studio.js before any
//   upload starts. The bucket is public-read so playback URLs work
//   without auth. See SUPABASE_SETUP.md.
// ============================================================

import { supabaseConfig, isSupabaseConfigured } from './supabase-config.js';

// 25 MB cap — checked client-side before the upload starts.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const base = () => supabaseConfig.SUPABASE_URL.replace(/\/+$/, '');
const bucket = () => supabaseConfig.BUCKET || 'song-files';

// No real init needed for the REST API; we just verify config once and
// give a clear error if the user hasn't filled in supabase-config.js.
let _checked = false;
export async function initStorage() {
  if (_checked) return true;
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured yet. Fill in js/shared/supabase-config.js (see SUPABASE_SETUP.md).');
  }
  _checked = true;
  return true;
}

// Build the object endpoint for a given storage path.
function objectUrl(path) {
  return `${base()}/storage/v1/object/${encodeURIComponent(bucket())}/${encodePath(path)}`;
}
// Public download URL (bucket must be public).
function publicUrl(path) {
  return `${base()}/storage/v1/object/public/${encodeURIComponent(bucket())}/${encodePath(path)}`;
}
// Encode each path segment but keep the slashes between folders.
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

// Upload a File/Blob and return { url, path }. Reports progress via
// onProgress(0..1) if provided. Uses XHR so we get upload progress.
// `upsert: true` lets us overwrite when an MD replaces a file.
export async function uploadFile(path, file, { onProgress } = {}) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${formatBytes(file.size)}). Limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
  }
  await initStorage();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', objectUrl(path), true);
    xhr.setRequestHeader('Authorization', `Bearer ${supabaseConfig.SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader('apikey', supabaseConfig.SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('Cache-Control', 'max-age=3600');
    // Overwrite if the object already exists (replace audio / chart / stem)
    xhr.setRequestHeader('x-upsert', 'true');

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ url: publicUrl(path), path });
      } else {
        reject(new Error(parseError(xhr) || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

// Delete a file by storage path. Best-effort — a missing file (404) is
// treated as already-deleted so cleanup flows don't break.
export async function deleteFile(path) {
  if (!path) return;
  await initStorage();
  try {
    const res = await fetch(objectUrl(path), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${supabaseConfig.SUPABASE_ANON_KEY}`,
        'apikey': supabaseConfig.SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok && res.status !== 404) {
      console.warn('[Storage] delete failed:', res.status);
    }
  } catch (e) {
    console.warn('[Storage] delete error:', e);
  }
}

// Pull a human-readable message out of a Supabase error response.
function parseError(xhr) {
  try {
    const j = JSON.parse(xhr.responseText);
    return j.message || j.error || j.msg;
  } catch (_) {
    return null;
  }
}

// Pretty-print a byte count. Used in error messages.
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
