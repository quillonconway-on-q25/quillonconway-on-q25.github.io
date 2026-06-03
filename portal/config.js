const SUPABASE_URL = 'https://wloaimrdkzsadytwmgww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qblzPwBNMnbs6nH-XClfrw_QVOTPFkZ';

// supabasejs v2 UMD exposes window.supabase = { createClient, ... }
// We overwrite it with the initialized client so all scripts can access it as `supabase`
const { createClient } = window.supabase;
window.supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('Supabase ready:', typeof window.supabase.auth);
