# Audio Studio — Supabase Storage setup

The Audio Studio stores audio, chord-chart images/PDFs, and stems in
**Supabase Storage** (free tier — no credit card required).

You only need to do this once.

## 1. Create the bucket

1. Go to https://supabase.com → open your project
2. Left sidebar → **Storage** → **New bucket**
3. Name it exactly: **`song-files`**
4. Toggle **Public bucket** ON (so audio/images get public playback URLs)
5. Click **Create bucket**

## 2. Add your keys to the app

1. In Supabase: **Project Settings** (gear) → **API**
2. Copy these two values:
   - **Project URL**
   - **Project API keys → `anon` `public`**
3. Open `js/shared/supabase-config.js` and paste them into
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

That's the minimum — uploads and playback will now work. The
"only the Music Director can upload" rule is enforced in the app.

## 3. (Recommended) Lock down writes with a policy

By default a public bucket still needs a policy to allow uploads. In
Supabase: **Storage → `song-files` → Policies → New policy → For full
customization**, then add these.

**Allow public read** (needed for playback):
```sql
create policy "Public read song-files"
on storage.objects for select
to public
using ( bucket_id = 'song-files' );
```

**Allow uploads/updates/deletes** (app enforces MD-only before calling):
```sql
create policy "Anon write song-files"
on storage.objects for insert
to anon
with check ( bucket_id = 'song-files' );

create policy "Anon update song-files"
on storage.objects for update
to anon
using ( bucket_id = 'song-files' );

create policy "Anon delete song-files"
on storage.objects for delete
to anon
using ( bucket_id = 'song-files' );
```

> Note: with the "simple" security model you chose, these policies let
> anyone with the anon key write to the bucket; the Studio UI only shows
> upload controls to the event's Music Director. If you later want
> server-enforced MD-only uploads, that requires wiring Supabase to trust
> Firebase Auth JWTs — ask and we can add it.

## What works without extra setup

- Audio playback, **speed**, **loop**, scrubbing
- **Pitch shift** — Supabase sends CORS headers by default, so this just
  works (no extra config, unlike Firebase)
- Chord charts (text + image/PDF), transpose, MD notes
- Stem upload slots + LALAL.AI link-out

## Free tier limits

1 GB stored, 2 GB/month bandwidth. Plenty for a worship team's library;
if you outgrow it, Supabase's paid tier or a bucket cleanup of old events
handles it.
