// ============================================================
// WORSHIPSYNC · js/shared/firestore.js
// ============================================================

import { firebaseConfig } from './firebase-config.js';
import { initFirebase as initAuthFirebase, getFirebaseApp } from './auth.js';

const FIREBASE_VERSION = '10.13.2';
const firestoreUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`;

let _db = null;
let _modules = null;
let _initPromise = null;

// Resolves once _db is ready. Writes that arrive before initFirestore()
// completes will await this instead of throwing "not initialized".
let _dbReadyResolve;
const _dbReady = new Promise(res => { _dbReadyResolve = res; });

function waitForDb() {
  return _dbReady;
}

export async function initFirestore() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    console.log('[Firestore] init started');
    await initAuthFirebase();
    const fsMod = await import(firestoreUrl);
    _modules = {
      getFirestore:              fsMod.getFirestore,
      collection:                fsMod.collection,
      doc:                       fsMod.doc,
      getDocs:                   fsMod.getDocs,
      getDoc:                    fsMod.getDoc,
      setDoc:                    fsMod.setDoc,
      updateDoc:                 fsMod.updateDoc,
      deleteDoc:                 fsMod.deleteDoc,
      writeBatch:                fsMod.writeBatch,
      query:                     fsMod.query,
      where:                     fsMod.where,
      orderBy:                   fsMod.orderBy,
      limit:                     fsMod.limit,
      serverTimestamp:           fsMod.serverTimestamp,
      onSnapshot:                fsMod.onSnapshot,
      enableIndexedDbPersistence: fsMod.enableIndexedDbPersistence,
    };
    _db = _modules.getFirestore(getFirebaseApp());
    console.log('[Firestore] _db ready — unblocking queued writes');
    _dbReadyResolve(); // unblock any writes that arrived early

    // Enable offline persistence (best-effort; fails silently on multi-tab)
    try {
      await _modules.enableIndexedDbPersistence(_db);
      console.log('[Firestore] IndexedDB persistence enabled');
    } catch (e) {
      console.warn('[Firestore] IndexedDB persistence not available:', e.code);
    }
    return _db;
  })();
  return _initPromise;
}

// ---- Read helpers ----
export async function getColl(name) {
  await waitForDb();
  const { collection, getDocs } = _modules;
  const snap = await getDocs(collection(_db, name));
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function getOne(collName, id) {
  await waitForDb();
  const { doc, getDoc } = _modules;
  const snap = await getDoc(doc(_db, collName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---- Real-time listener ----
// Subscribes to a collection with onSnapshot. Calls onChange(docs[]) every
// time Firestore pushes an update (add, edit, delete). Returns an unsubscribe fn.
export async function subscribeColl(name, onChange) {
  await waitForDb();
  const { collection, onSnapshot } = _modules;
  const colRef = collection(_db, name);
  const unsubscribe = onSnapshot(
    colRef,
    snap => {
      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      onChange(docs);
    },
    err => console.error(`[Firestore] onSnapshot error on ${name}:`, err)
  );
  return unsubscribe;
}

// ---- Write helpers ----
export async function setOne(collName, id, data) {
  await waitForDb();
  const { doc, setDoc } = _modules;
  const idStr = String(id);
  console.log(`[Firestore] setOne → ${collName}/${idStr}`);
  try {
    await setDoc(doc(_db, collName, idStr), stripUndefined(data));
    console.log(`[Firestore] setOne OK → ${collName}/${idStr}`);
  } catch (err) {
    console.error(`[Firestore] setOne FAILED → ${collName}/${idStr}`, err);
    throw err;
  }
}

export async function updateOne(collName, id, patch) {
  await waitForDb();
  const { doc, updateDoc } = _modules;
  const idStr = String(id);
  console.log(`[Firestore] updateOne → ${collName}/${idStr}`);
  try {
    await updateDoc(doc(_db, collName, idStr), stripUndefined(patch));
    console.log(`[Firestore] updateOne OK → ${collName}/${idStr}`);
  } catch (err) {
    console.error(`[Firestore] updateOne FAILED → ${collName}/${idStr}`, err);
    throw err;
  }
}

export async function deleteOne(collName, id) {
  await waitForDb();
  const { doc, deleteDoc } = _modules;
  const idStr = String(id);
  console.log(`[Firestore] deleteOne → ${collName}/${idStr}`);
  try {
    await deleteDoc(doc(_db, collName, idStr));
    console.log(`[Firestore] deleteOne OK → ${collName}/${idStr}`);
  } catch (err) {
    console.error(`[Firestore] deleteOne FAILED → ${collName}/${idStr}`, err);
    throw err;
  }
}

// Strip undefined fields (Firestore rejects them)
function stripUndefined(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    out[k] = stripUndefined(obj[k]);
  }
  return out;
}

// Best-effort fire-and-forget wrapper
export function fireAndForget(promise, label = 'firestore write') {
  if (!promise || !promise.catch) return;
  promise.catch(err => console.warn(`[${label}] failed:`, err));
}
