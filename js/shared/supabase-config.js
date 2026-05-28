// ============================================================
// WORSHIPSYNC · js/shared/supabase-config.js
// Supabase Storage config for the Audio Studio.
//
// HOW TO FILL THIS IN (one time):
// 1. Go to https://supabase.com → your project
// 2. Project Settings (gear icon) → "API"
//    - Copy "Project URL"           → SUPABASE_URL below
//    - Copy "Project API keys" → "anon public" → SUPABASE_ANON_KEY below
// 3. Storage (left sidebar) → "New bucket"
//    - Name it exactly:  song-files
//    - Toggle "Public bucket" ON  (so audio/images get public URLs)
//    - Click "Create bucket"
// 4. (Optional) Storage → song-files → Policies → see SUPABASE_SETUP.md
//    for the upload/delete policy to paste.
// ============================================================

export const supabaseConfig = {
  // Base project URL (no trailing /rest/v1)
  SUPABASE_URL: "https://bffwaldphbisnidkwekv.supabase.co",

  // The publishable/anon key — safe to expose in client code.
  SUPABASE_ANON_KEY: "sb_publishable_qnUhOqD_tMfGQSqCvLe-hg_EjCoWrYt",

  // The Storage bucket name you created (must be a PUBLIC bucket).
  BUCKET: "song-files",
};

export function isSupabaseConfigured() {
  return !supabaseConfig.SUPABASE_URL.startsWith('PASTE_')
      && !supabaseConfig.SUPABASE_ANON_KEY.startsWith('PASTE_');
}
