// ============================================================
// WORSHIPSYNC · js/shared/firebase-config.js
// Firebase project config (pre-filled — you don't have to edit this).
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyAeFXOlxQ7Ln2mK2MnpR8KpJtAphqDMcRA",
  authDomain: "worshipsync-88809.firebaseapp.com",
  projectId: "worshipsync-88809",
  storageBucket: "worshipsync-88809.firebasestorage.app",
  messagingSenderId: "439615682480",
  appId: "1:439615682480:web:152f80e8dda5edb5274875",
  measurementId: "G-QBTSV6WLYC"
};

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith('PASTE_');
}
