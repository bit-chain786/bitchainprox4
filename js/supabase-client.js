/* ==========================================================================
   BITCHAIN PRO X — SUPABASE CLIENT & AUTHENTICATION MODULE
   Handles Supabase client initialization, auth sessions, profile data,
   and referral attributions.
   ========================================================================== */

// Configurable Supabase credentials
// Note: Users can plug in their own credentials or update them via localStorage / config.
const DEFAULT_SUPABASE_URL = localStorage.getItem('BITCHAIN_SUPABASE_URL') || 'https://cwzhihzlxbtkuoqsnkin.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = localStorage.getItem('BITCHAIN_SUPABASE_ANON_KEY') || 'sb_publishable_gYl3A7Y660B6Dti6-rY9bA_AeOi0DsR';

let supabaseClient = null;

/**
 * Initializes and returns the Supabase client instance.
 */
function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = window.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return supabaseClient;
  } else {
    console.warn('Supabase JS SDK not loaded yet.');
    return null;
  }
}

/**
 * Helper to update local Supabase credentials dynamically if needed.
 */
function setSupabaseCredentials(url, anonKey) {
  if (url && anonKey) {
    localStorage.setItem('BITCHAIN_SUPABASE_URL', url);
    localStorage.setItem('BITCHAIN_SUPABASE_ANON_KEY', anonKey);
    supabaseClient = window.supabase.createClient(url, anonKey);
    console.log('Supabase credentials updated successfully!');
    return true;
  }
  return false;
}

/**
 * Checks if a sponsor username exists in the profiles database.
 */
async function checkSponsorExists(sponsorUsername) {
  if (!sponsorUsername || !sponsorUsername.trim()) return true; // Optional field
  const client = getSupabase();
  if (!client) return true;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('username')
      .eq('username', sponsorUsername.trim())
      .maybeSingle();

    if (error) {
      console.warn('Sponsor query error:', error.message);
      return true; // Allow signup if query fails or table not yet seeded
    }
    return !!data;
  } catch (err) {
    console.warn('Sponsor check exception:', err);
    return true;
  }
}

/**
 * Register a new user using Supabase Auth and save profile data.
 */
async function signUpUser({ fullName, username, email, phone, password, sponsorUsername }) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  // Generate unique referral code for the new user
  const generatedRefCode = username.toUpperCase().replace(/[^A-Z0-9]/g, '') + Math.floor(100 + Math.random() * 900);

  // 1. Sign up with Supabase Auth
  const { data: authData, error: authError } = await client.auth.signUp({
    email: email.trim(),
    password: password,
    options: {
      data: {
        full_name: fullName.trim(),
        username: username.trim(),
        phone: phone.trim(),
        sponsor_username: sponsorUsername ? sponsorUsername.trim() : null,
        referral_code: generatedRefCode
      }
    }
  });

  if (authError) throw authError;

  const user = authData.user;
  if (!user) throw new Error('Registration failed: No user returned from Supabase Auth.');

  // 2. Insert profile record in 'profiles' table
  try {
    const profilePayload = {
      id: user.id,
      full_name: fullName.trim(),
      username: username.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      sponsor_username: sponsorUsername ? sponsorUsername.trim() : null,
      referral_code: generatedRefCode,
      rank: null,
      rank_value: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: profileError } = await client
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });

    if (profileError) {
      console.warn('Profile insertion error (handled via fallback):', profileError.message);
    }
  } catch (err) {
    console.warn('Profile sync warning:', err);
  }

  // If session is not returned immediately (e.g. standard signup flow), attempt instant auto-login to establish session
  if (!authData.session) {
    try {
      const { data: signInData } = await client.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });
      if (signInData && signInData.session) {
        authData.session = signInData.session;
      }
    } catch (e) {
      console.warn('Auto sign-in after sign up note:', e.message);
    }
  }

  // Store profile in localStorage as session fallback cache
  const localProfile = {
    id: user.id,
    full_name: fullName.trim(),
    username: username.trim(),
    email: email.trim(),
    phone: phone.trim(),
    sponsor_username: sponsorUsername ? sponsorUsername.trim() : null,
    referral_code: generatedRefCode
  };
  localStorage.setItem('bitchain_user_profile', JSON.stringify(localProfile));

  return authData;
}

/**
 * Sign in an existing user with Email + Password.
 */
async function signInUser({ email, password }) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password: password
  });

  if (error) throw error;

  // Fetch user profile from DB after successful sign-in
  if (data.user) {
    try {
      const profile = await getUserProfile(data.user.id);
      if (profile) {
        localStorage.setItem('bitchain_user_profile', JSON.stringify(profile));
      } else {
        // Fallback user profile if table row doesn't exist yet
        const meta = data.user.user_metadata || {};
        const fallbackProfile = {
          id: data.user.id,
          full_name: meta.full_name || email.split('@')[0],
          username: meta.username || email.split('@')[0],
          email: data.user.email,
          phone: meta.phone || '',
          sponsor_username: meta.sponsor_username || null,
          referral_code: meta.referral_code || 'REF' + Math.floor(Math.random() * 10000)
        };
        localStorage.setItem('bitchain_user_profile', JSON.stringify(fallbackProfile));
      }
    } catch (e) {
      console.warn('Error fetching user profile after login:', e);
    }
  }

  return data;
}

/**
 * Send password reset link to user's email.
 */
async function resetPasswordEmail(email) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  const redirectUrl = window.location.origin + '/reset-password.html';
  const { data, error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: redirectUrl
  });

  if (error) throw error;
  return data;
}

/**
 * Update authenticated user's password.
 */
async function updateUserPassword(newPassword) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  const { data, error } = await client.auth.updateUser({
    password: newPassword
  });

  if (error) throw error;
  return data;
}

/**
 * Fetch profile data for a given user ID.
 */
async function getUserProfile(userId) {
  const client = getSupabase();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching profile:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Exception fetching profile:', err);
    return null;
  }
}

/**
 * Sign out the current user session.
 */
async function signOutUser() {
  const client = getSupabase();
  localStorage.removeItem('bitchain_user_profile');
  if (window.GlobalAvatar && typeof window.GlobalAvatar.clear === 'function') {
    window.GlobalAvatar.clear();
  }
  // Clear any residual user storage
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('bitchain_avatar_') || key.startsWith('bitchain_user_')) {
      localStorage.removeItem(key);
    }
  });
  if (client) {
    await client.auth.signOut();
  }
  window.location.href = 'login.html';
}

/**
 * Listen for authentication state changes.
 */
function onAuthStateChanged(callback) {
  const client = getSupabase();
  if (!client) return;

  client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

/**
 * Fetch recent activities for a given user ID.
 */
async function getUserActivities(userId, limit = 5) {
  const client = getSupabase();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('Activities query notice:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Activities fetch exception:', err);
    return [];
  }
}

/**
 * Get current session user.
 */
async function getCurrentUser() {
  const client = getSupabase();
  if (!client) return null;

  try {
    const { data } = await client.auth.getUser();
    return data?.user || null;
  } catch (e) {
    return null;
  }
}

// Export functions to global scope
window.BitchainAuth = {
  getSupabase,
  setSupabaseCredentials,
  checkSponsorExists,
  signUpUser,
  signInUser,
  resetPasswordEmail,
  updateUserPassword,
  getUserProfile,
  getUserActivities,
  signOutUser,
  onAuthStateChanged,
  getCurrentUser
};
