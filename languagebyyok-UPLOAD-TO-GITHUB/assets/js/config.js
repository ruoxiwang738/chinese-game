/* =============================================================================
   CONFIGURATION  -  this is the only file you need to edit.
   =============================================================================

   1. Create a free project at https://supabase.com
   2. Settings -> API Keys  ->  copy the PUBLISHABLE key (starts sb_publishable_).
      On older projects this is the key labelled "anon public" instead - either works.
      Settings -> Data API  ->  copy the Project URL.
   3. Paste them below and save.

   The publishable key is designed to be public - it is safe in a GitHub repo.
   Your data is protected by the row-level security rules in db/schema.sql, not
   by hiding this key.

   NEVER paste the "secret" or "service_role" key here. That one bypasses every
   security rule, and anyone visiting your site could read and delete everything.

   Leave them blank to run the site in PRACTICE MODE: everything works, but
   results are stored only in that browser and you will not see them.
   ============================================================================= */

window.IELTS_CONFIG = {
  SUPABASE_URL: '',        // e.g. 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: '',   // the publishable (or anon public) key

  // Shown in the header and on the results page.
  SITE_NAME: 'Language by Yok',
  TAGLINE: 'IELTS Academic Reading',

  // Minutes allowed for a full paper. The real test is 60.
  DURATION_MINUTES: 60,

  // Warn the student at these points (minutes remaining).
  WARN_AT: [10, 5, 1],
};
