// ============================================================
// WORSHIPSYNC · js/shared/auth.js
// ------------------------------------------------------------
// Wraps Firebase Auth. Loaded as an ES module from the CDN
// so no build step is needed.
//
// Exports:
//   - initFirebase()              — call once at app start
//   - signUp(name, email, pwd)    — creates account, sends verification email
//   - logIn(email, pwd)           — signs in existing user
//   - logOut()                    — signs out
//   - requireAuth()               — redirects to login.html if not signed in
//   - onAuthReady(cb)             — fires once auth state is known
//   - getAuthUser()               — returns the current Firebase user (or null)
// ============================================================

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

// We import Firebase from the CDN as ES modules — no npm needed.
const FIREBASE_VERSION = '10.13.2';
const appUrl  = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const authUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`;

let _app = null;
let _auth = null;
let _firebaseModules = null;   // { initializeApp, getAuth, createUser..., signIn..., signOut, sendEmailVerification, onAuthStateChanged, updateProfile }
let _authReadyPromise = null;
let _currentUser = null;

// ============================================================
// INITIALIZATION
// ============================================================
export async function initFirebase() {
  if (_auth) return _auth;
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase config not filled in. Edit js/shared/firebase-config.js with your project values.');
  }

  // Dynamically import the CDN modules
  const [appMod, authMod] = await Promise.all([
    import(appUrl),
    import(authUrl),
  ]);

  _firebaseModules = {
    initializeApp: appMod.initializeApp,
    getAuth: authMod.getAuth,
    createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
    signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
    signOut: authMod.signOut,
    sendEmailVerification: authMod.sendEmailVerification,
    onAuthStateChanged: authMod.onAuthStateChanged,
    updateProfile: authMod.updateProfile,
    setPersistence: authMod.setPersistence,
    inMemoryPersistence: authMod.inMemoryPersistence,
    browserSessionPersistence: authMod.browserSessionPersistence,
    browserLocalPersistence: authMod.browserLocalPersistence,
  };

  _app = _firebaseModules.initializeApp(firebaseConfig);
  _auth = _firebaseModules.getAuth(_app);

  // Local persistence: the auth state survives page-to-page navigation AND
  // browser/tab closes. The user stays logged in on this device until they
  // explicitly click the logout button.
  try {
    await _firebaseModules.setPersistence(_auth, _firebaseModules.browserLocalPersistence);
  } catch (_) { /* non-fatal */ }

  // Track auth state
  _authReadyPromise = new Promise(resolve => {
    const unsub = _firebaseModules.onAuthStateChanged(_auth, (user) => {
      _currentUser = user;
      resolve(user);
    });
    // unsub stays alive — we want continuous updates
  });

  await _authReadyPromise;
  return _auth;
}

// ============================================================
// PUBLIC HELPERS
// ============================================================

export function onAuthReady(cb) {
  if (_authReadyPromise) {
    _authReadyPromise.then(cb);
  } else {
    initFirebase().then(() => cb(_currentUser));
  }
}

export function getAuthUser() {
  return _currentUser;
}

// Used by firestore.js to attach to the same app instance
export function getFirebaseApp() {
  return _app;
}

export async function signUp({ name, email, password, roles = [] }) {
  await initFirebase();
  const { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } = _firebaseModules;
  const cred = await createUserWithEmailAndPassword(_auth, email, password);

  // Set the display name so we can show it later
  if (name) {
    try { await updateProfile(cred.user, { displayName: name }); } catch (_) {}
  }

  // Send the verification email FIRST. This is the critical user-visible step
  // and must succeed before we do anything else that could fail.
  // (If Firestore is misconfigured, the write below could hang or throw —
  // we don't want that to block the email from being sent.)
  await sendEmailVerification(cred.user);

  // Now write the account document to Firestore. If this fails (e.g. security
  // rules not published yet, or Firestore not created), we log a warning and
  // continue — ensureUserAccount() will backfill on first login.
  // Don't await: fire-and-forget so signup completes fast and the user gets
  // redirected to verify-email immediately.
  (async () => {
    try {
      const { initFirestore, setOne } = await import('./firestore.js');
      await initFirestore();
      const parts = (name || cred.user.email.split('@')[0]).split(' ');
      const accountDoc = {
        id: cred.user.uid,
        name: name || cred.user.email.split('@')[0],
        firstName: parts[0] || '',
        email: email,
        initials: parts.map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'U',
        color: pickColor(cred.user.uid),
        primaryRole: roles[0] || '',
        roles: Array.isArray(roles) ? roles : [],
        isAdmin: false,
        isSeedAdmin: false,
        joinedAt: new Date().toISOString().slice(0, 10),
      };
      await setOne('accounts', cred.user.uid, accountDoc);
    } catch (e) {
      console.warn('Failed to write account doc at signup:', e);
    }
  })();

  return cred.user;
}

function pickColor(seed) {
  const colors = ['green', 'amber', 'rose', 'blue', 'teal', 'stone'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

export async function logIn({ email, password }) {
  await initFirebase();
  const { signInWithEmailAndPassword } = _firebaseModules;
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

export async function logOut() {
  // Clear our local user pointers BEFORE the redirect so the next user gets clean state
  try {
    const data = await import('./data.js');
    data.clearActiveUid();
  } catch (_) {}
  try { localStorage.removeItem('worshipsync.session'); } catch (_) {}
  if (_auth) {
    const { signOut } = _firebaseModules;
    try { await signOut(_auth); } catch (_) {}
  }
  location.href = 'login.html';
}

// Resend verification email (for users stuck on the "verify your email" screen)
export async function resendVerificationEmail() {
  await initFirebase();
  const { sendEmailVerification } = _firebaseModules;
  if (!_currentUser) throw new Error('Not signed in');
  await sendEmailVerification(_currentUser);
}

// Auth gate: call at the top of every protected page.
// Redirects to login.html if no user is signed in.
// If `requireVerified` is true, also redirects to verify-email.html when email
// hasn't been verified yet.
// On success, loads data from Firestore. The account doc was written at signup
// time, so it should already exist — but we call ensureUserAccount() as a
// defensive backfill (e.g., if signup's Firestore write failed for some reason).
export async function requireAuth({ requireVerified = true } = {}) {
  await initFirebase();
  const user = _currentUser;
  if (!user) {
    location.href = 'login.html';
    return null;
  }
  if (requireVerified && !user.emailVerified) {
    location.href = 'verify-email.html';
    return null;
  }

  try {
    const data = await import('./data.js');
    await data.loadAllFromFirestore();
    // Defensive backfill: if the account doc somehow doesn't exist (e.g., signup's
    // Firestore write failed), create one from the Firebase Auth profile.
    data.ensureUserAccount(user.uid, {
      name: user.displayName || (user.email?.split('@')[0] || 'User'),
      email: user.email || '',
      roles: [],
    });
  } catch (e) {
    console.warn('Failed to load user data:', e);
  }

  return user;
}

// Friendly error messages from Firebase error codes
export function friendlyAuthError(error) {
  const code = error?.code || '';
  const map = {
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
    'auth/network-request-failed': 'Network error — check your connection.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in your Firebase project.',
  };
  return map[code] || error?.message || 'Something went wrong. Try again.';
}
