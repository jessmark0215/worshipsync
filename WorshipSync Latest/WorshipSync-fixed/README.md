# WorshipSync · Worship Team Dashboard

Multi-user worship team scheduling app — Firebase Auth + Firestore.

## What's new in this version

- **All app data now lives in Firestore** (not localStorage)
- **Multi-user shared state**: when admin creates an event, every assigned user sees it on their dashboard from any device
- **Persistent storage**: data survives browser clears, device changes, and never expires
- **Firebase Auth** for login/signup/email verification

## Setup (one-time)

### 1. Enable Email/Password Authentication

1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **wlbc-official-project**
3. Build → Authentication → Get started
4. Sign-in method tab → **Email/Password** → Enable → Save

### 2. Create Firestore database

1. Build → Firestore Database → Create database
2. Region: **asia-southeast1** (Singapore, closest to Cebu)
3. **Start in production mode** (do NOT pick test mode — it auto-expires in 30 days)
4. Click Create

### 3. Install the security rules (permanent, not 30-day)

1. In Firestore → **Rules** tab
2. Replace everything in the rules editor with the contents of `firestore.rules` (in this project)
3. Click **Publish**

That's it — your Firebase config is already pre-filled in `js/shared/firebase-config.js`.

## How to run

```bash
cd worship-app
python3 -m http.server 8000
```

Open <http://localhost:8000/login.html>

## How the data flows

1. **You sign up** → Firebase Auth creates the user → sends verification email
2. **You click the verification link** → email_verified = true
3. **You return to the app** → loadAllFromFirestore() pulls all collections
4. **First-time login** → your account doc gets written to Firestore (with the roles you picked at signup)
5. **Admin views members** → reads from the shared `accounts` collection → sees you
6. **Admin assigns you to an event** → event doc updated → notification doc created targeting you
7. **You reload your dashboard** → sees the new event under "My Schedules"
8. **You accept** → event's team[].status updated → admin gets a notification

All writes are fire-and-forget for snappy UI. Firestore's offline cache handles brief network drops.

## Firestore data structure

```
accounts/
  u_admin                  ← seed admin (auto-bootstrapped on first run)
  {firebase_uid_1}/        ← real user
  {firebase_uid_2}/
  ...
events/
  {evt_id_1}/              ← {title, date, time, team[], setlist[], ...}
  ...
templates/
  {tpl_id_1}/              ← recurring event templates with rotations
notifications/
  {n_xxx}/                 ← {forUserId, eventId, icon, text, unread, createdAt}
archive/                   ← cold storage for old events
analytics/                 ← (reserved for stage 3)
```

## The test-admin toggle

The topbar 🔄 button lets you flip between your real account and the seed admin (Admin Pastor) — this is for testing admin features only and will be removed for production.

When you "view as admin", you can:
- See the Admin sidebar section
- Create events / templates / promote members
- All changes write to the same Firestore (no separate namespace anymore)

Click 🔄 again to flip back to your real account.

## Files

```
worship-app/
├── login.html              ← entry point
├── signup.html             ← create account with role selection
├── verify-email.html       ← post-signup verification
│
├── index.html              ← My Schedules (requires auth)
├── admin-overview.html     ← Admin dashboard
├── admin-events.html       ← Manage events + recurring templates
├── admin-members.html      ← Manage musicians + admins
├── ... (other stub pages)
│
├── firestore.rules         ← paste into Firebase Console
│
├── css/
└── js/
    ├── shared/
    │   ├── firebase-config.js  (pre-filled with your project)
    │   ├── auth.js             (Firebase Auth wrapper)
    │   ├── firestore.js        (Firestore CRUD wrapper)
    │   ├── data.js             (in-memory state mirrored from Firestore)
    │   ├── shell.js, ui.js, verse.js
    │   ├── notifications.js, search.js, analytics.js
    └── pages/
        ├── my-schedules.js
        ├── admin-overview.js, admin-events.js, admin-members.js
```

## Troubleshooting

- **Console error: "Missing or insufficient permissions"** — you forgot to publish the security rules from `firestore.rules`
- **Blank dashboard** — check the browser console for errors. Most likely Firestore isn't created yet or rules aren't published.
- **Stuck on "Loading..."** — network issue, or the Firestore database wasn't created. Check the console for the actual error.
- **Can't sign in** — make sure Email/Password authentication is enabled in Firebase Console.

## Console commands

```js
worshipSyncReset()   // clears local data (test-admin toggle, etc.) and reloads.
                     // Does NOT delete Firestore data — use Firebase Console for that.
```

## What's NOT in Firestore (still client-side)

- The test-admin toggle (per-device dev convenience)
- Audio file blobs (kept as metadata only — actual blobs need Firebase Storage in stage 3)
- Analytics heartbeats (would be noisy at 30s frequency — defer to stage 3)

## What's coming next

- Audio Studio with Firebase Storage for song MP3s
- Real-time updates via Firestore `onSnapshot` listeners
- Analytics dashboard with actual session data
- Admin promotion via invite code (replaces the "view as admin" dev toggle)
