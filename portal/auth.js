// Shared auth utilities — included on every portal page

async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/portal/login';
    return null;
  }
  return session;
}

async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  // If profile was deleted but auth account still exists, auto-restore it
  if (!data) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const restored = {
        id: userId,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Client',
        is_admin: false
      };
      await supabase.from('profiles').upsert(restored);
      return restored;
    }
  }
  return data;
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/portal/login';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// Clean a name — if it looks like an email, use just the local part formatted
function cleanName(raw) {
  if (!raw) return null;
  if (raw.includes('@')) {
    // e.g. "quillonconway@on-q25.com" → "Quillon Conway" isn't possible,
    // so just capitalize the local part
    return raw.split('@')[0].replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, c => c.toUpperCase());
  }
  return raw;
}

// Populate nav user info once profile loads
function setNavUser(profile, session) {
  const nameEl = document.getElementById('navName');
  const initEl = document.getElementById('navInitial');
  if (!profile && !session) return;
  const raw = cleanName(profile?.full_name) || session?.user?.email?.split('@')[0] || 'Client';
  if (nameEl) nameEl.textContent = raw;
  if (initEl) initEl.textContent = raw.charAt(0).toUpperCase();
}
