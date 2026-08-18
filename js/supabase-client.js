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
 * Fetch unified transaction activity history for a user:
 * - Deposits (pending, approved, completed, rejected)
 * - Withdrawals (pending, approved, completed, rejected)
 * - Package / Rank Purchases
 * - Reward Claims
 * - Commission activities (direct, team, non-working, reward)
 */

// Helper: safely convert any value to a display string (prevents [object Object])
function safeStr(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    // Try extracting a known message key, else return empty
    return val.message || val.text || val.description || val.details || fallback;
  }
  return String(val);
}

async function getUserActivities(userId, limit = 15) {
  const client = getSupabase();
  if (!client || !userId) return [];

  const combinedList = [];

  try {
    // 1. Fetch general activities (commissions, non-working income, etc.)
    const { data: actData } = await client
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (actData && actData.length > 0) {
      actData.forEach(item => {
        combinedList.push({
          id: item.id,
          title: safeStr(item.title, 'Income Received'),
          details: safeStr(item.details, 'Commission Credit'),
          amount: parseFloat(item.amount) || 0,
          type: 'income',
          status: 'completed',
          category: item.category || 'direct',
          created_at: item.created_at
        });
      });
    }
  } catch (e) {
    console.warn('Activities fetch note:', e);
  }

  try {
    // 2. Fetch Deposits
    const { data: depData } = await client
      .from('deposits')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (depData && depData.length > 0) {
      depData.forEach(dep => {
        const st = (dep.status || 'pending').toLowerCase();
        let detailText = '';
        let titleText = 'Wallet Deposit';
        if (st === 'pending') {
          titleText = 'Deposit Pending';
          detailText = `BEP-20 USDT Deposit of $${parseFloat(dep.amount).toFixed(2)} — Awaiting admin approval`;
        } else if (st === 'approved' || st === 'completed') {
          titleText = 'Deposit Approved';
          detailText = `BEP-20 USDT Deposit of $${parseFloat(dep.amount).toFixed(2)} — Approved & credited`;
        } else if (st === 'rejected') {
          titleText = 'Deposit Rejected';
          detailText = `BEP-20 USDT Deposit of $${parseFloat(dep.amount).toFixed(2)} — Rejected by admin`;
        } else {
          detailText = `BEP-20 USDT Deposit (${st.toUpperCase()})`;
        }
        combinedList.push({
          id: dep.id,
          title: titleText,
          details: detailText,
          amount: parseFloat(dep.amount) || 0,
          type: 'deposit',
          status: st,
          category: 'deposit',
          created_at: dep.created_at
        });
      });
    }
  } catch (e) {
    console.warn('Deposits fetch note:', e);
  }


  try {
    // 3. Fetch Withdrawals
    const { data: withData } = await client
      .from('withdrawals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (withData && withData.length > 0) {
      withData.forEach(w => {
        const st = (w.status || 'pending').toLowerCase();
        let detailText = '';
        if (st === 'pending') {
          detailText = `Withdrawal of $${parseFloat(w.amount).toFixed(2)} USDT — Awaiting admin approval`;
        } else if (st === 'approved') {
          detailText = `Withdrawal of $${parseFloat(w.amount).toFixed(2)} USDT — Approved & processed successfully`;
        } else if (st === 'rejected') {
          const reason = w.rejection_reason || w.admin_notes || 'No reason provided';
          detailText = `Withdrawal Rejected & Refunded — Reason: ${reason}`;
        } else {
          detailText = `BEP-20 USDT Payout (${st.toUpperCase()})`;
        }
        combinedList.push({
          id: w.id,
          title: st === 'rejected' ? 'Withdrawal Rejected – Refunded' : st === 'approved' ? 'Withdrawal Approved' : 'Withdrawal Pending',
          details: detailText,
          amount: parseFloat(w.amount) || 0,
          type: 'withdrawal',
          status: st,
          category: 'withdrawal',
          created_at: w.created_at
        });
      });
    }

  } catch (e) {
    console.warn('Withdrawals fetch note:', e);
  }

  try {
    // 4. Fetch Package / Rank Purchases
    const { data: pkgData } = await client
      .from('package_purchases')
      .select('*')
      .eq('user_id', userId)
      .order('purchased_at', { ascending: false })
      .limit(limit);

    if (pkgData && pkgData.length > 0) {
      pkgData.forEach(p => {
        combinedList.push({
          id: p.id,
          title: `${p.rank_name || p.package_name || 'Rank'} Upgrade`,
          details: `Activated Package Tier ${p.package_name || ''}`,
          amount: parseFloat(p.amount) || 0,
          type: 'purchase',
          status: p.status || 'completed',
          category: 'purchase',
          created_at: p.purchased_at || p.created_at
        });
      });
    }
  } catch (e) {
    console.warn('Package purchases fetch note:', e);
  }

  try {
    // 5. Fetch Reward Claims
    const { data: rewardData } = await client
      .from('reward_claims')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (rewardData && rewardData.length > 0) {
      rewardData.forEach(r => {
        combinedList.push({
          id: r.id,
          title: `Reward Level ${r.level} Bonus`,
          details: `Achieved $${parseFloat(r.target_amount).toLocaleString()} Direct Business`,
          amount: parseFloat(r.reward_amount) || 0,
          type: 'reward',
          status: r.status || 'claimed',
          category: 'reward',
          created_at: r.created_at
        });
      });
    }
  } catch (e) {
    console.warn('Reward claims fetch note:', e);
  }

  // Sort unified transaction activities chronologically (newest first)
  combinedList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return combinedList.slice(0, limit);
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
