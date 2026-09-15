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
 * Helper: Generate random 5-character uppercase alphanumeric referral code (e.g. X8K2M)
 */
function generate5CharRefCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Register a new user using Supabase Auth and save profile data.
 */
async function signUpUser({ fullName, username, email, phone, password, sponsorUsername }) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  // Generate unique 5-character referral code for the new user (e.g. X8K2M)
  const generatedRefCode = generate5CharRefCode();

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
 * Send / Request real-time password reset OTP and trigger email dispatch.
 */
async function resetPasswordEmail(email) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  const cleanEmail = email.trim().toLowerCase();
  let generatedOtp = null;
  let rpcSuccess = false;

  // 1. Generate & store 6-digit OTP in database via PostgreSQL RPC
  try {
    const { data: rpcData, error: rpcError } = await client.rpc('request_password_reset_otp', {
      p_email: cleanEmail
    });

    if (rpcError) {
      console.warn('RPC request_password_reset_otp notice:', rpcError.message);
    } else if (rpcData) {
      if (rpcData.success) {
        rpcSuccess = true;
        generatedOtp = rpcData.otp_code;
        console.log('⚡ Real-time OTP successfully generated in database:', generatedOtp);
      } else {
        throw new Error(rpcData.error || 'Failed to generate OTP for this email.');
      }
    }
  } catch (rpcEx) {
    console.warn('RPC exception, checking fallback:', rpcEx);
    if (rpcEx.message && rpcEx.message.includes('No account found')) {
      throw rpcEx;
    }
  }

  // 2. Also trigger Supabase standard Auth password reset email as secondary channel
  try {
    const redirectUrl = window.location.origin + '/forgot-password.html';
    await client.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: redirectUrl
    });
  } catch (e) {
    console.warn('Supabase Auth reset email channel note:', e.message);
  }

  // 3. Direct EmailJS real-time dispatch if initialized
  if (generatedOtp && window.emailjs && typeof window.emailjs.send === 'function') {
    try {
      const serviceId = localStorage.getItem('BITCHAIN_EMAILJS_SERVICE_ID') || 'service_bitchain';
      const templateId = localStorage.getItem('BITCHAIN_EMAILJS_TEMPLATE_ID') || 'template_otp';
      await window.emailjs.send(serviceId, templateId, {
        to_email: cleanEmail,
        otp_code: generatedOtp,
        app_name: 'BITCHAIN PRO X',
        valid_mins: '10'
      });
    } catch (err) {
      console.warn('Direct EmailJS dispatch note:', err);
    }
  }

  return {
    success: true,
    email: cleanEmail,
    otp_code: generatedOtp,
    rpc_success: rpcSuccess
  };
}

/**
 * Verify OTP code for password recovery.
 */
async function verifyPasswordOtp(email, token) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = token.trim();

  // 1. Verify via database RPC (Real-time DB-backed OTP)
  try {
    const { data: rpcData, error: rpcError } = await client.rpc('verify_password_reset_otp', {
      p_email: cleanEmail,
      p_otp: cleanOtp
    });

    if (!rpcError && rpcData && rpcData.success) {
      return { success: true, verified: true, message: rpcData.message };
    }
    if (rpcData && !rpcData.success && rpcData.error) {
      console.warn('RPC verify returned false:', rpcData.error);
    }
  } catch (e) {
    console.warn('RPC OTP verification note:', e);
  }

  // 2. Fallback: Verify via Supabase Auth recovery session
  let res = await client.auth.verifyOtp({
    email: cleanEmail,
    token: cleanOtp,
    type: 'recovery'
  });

  if (res.error) {
    const resFallback = await client.auth.verifyOtp({
      email: cleanEmail,
      token: cleanOtp,
      type: 'email'
    });
    if (resFallback.error) {
      throw new Error('Invalid or expired verification code. Please check your code or click Resend.');
    }
    res = resFallback;
  }

  return res.data;
}

/**
 * Update user's password with verified OTP or active session.
 */
async function updateUserPassword(newPassword, email = null, otp = null) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase client is not initialized.');

  // 1. If email and OTP are provided, update via PostgreSQL RPC (100% direct & instant)
  if (email && otp) {
    try {
      const { data: rpcData, error: rpcError } = await client.rpc('verify_and_update_password', {
        p_email: email.trim().toLowerCase(),
        p_otp: otp.trim(),
        p_new_password: newPassword
      });

      if (rpcError) {
        console.warn('RPC verify_and_update_password note:', rpcError.message);
      } else if (rpcData) {
        if (rpcData.success) {
          return rpcData;
        } else {
          throw new Error(rpcData.error || 'Failed to update password.');
        }
      }
    } catch (rpcErr) {
      console.warn('RPC password update error, falling back to auth.updateUser:', rpcErr.message);
      if (rpcErr.message && !rpcErr.message.includes('function') && !rpcErr.message.includes('schema')) {
        throw rpcErr;
      }
    }
  }

  // 2. Update via Supabase Auth session
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
    const [actRes, depRes, withRes, pkgRes, rewardRes, teamRes] = await Promise.allSettled([
      client.from('activities').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
      client.from('deposits').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
      client.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
      client.from('package_purchases').select('*').eq('user_id', userId).order('purchased_at', { ascending: false }).limit(limit),
      client.from('reward_claims').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
      client.from('team_income_log').select('*').eq('recipient_id', userId).order('created_at', { ascending: false }).limit(limit)
    ]);

    // 1. Activities (Direct income, team income, rewards, system credits)
    // Note: Withdrawals and deposits are handled exclusively below from their primary tables.
    if (actRes.status === 'fulfilled' && actRes.value.data) {
      actRes.value.data.forEach(item => {
        // Skip any withdrawal records from activities table to prevent duplicate feed entries
        if (item.category === 'withdrawal' || item.type === 'withdrawal' || (item.title && item.title.toLowerCase().includes('withdrawal'))) {
          return;
        }

        // Skip premature notifications or non-financial items — only show when actually claimed / income
        if (item.type === 'claimable' || item.type === 'info' || (item.title && item.title.toLowerCase().includes('ready to claim')) || (parseFloat(item.amount) || 0) <= 0) {
          return;
        }

        combinedList.push({
          id: item.id,
          title: safeStr(item.title, 'Income Received'),
          details: safeStr(item.details, 'Commission Credit'),
          amount: parseFloat(item.amount) || 0,
          type: item.type || 'income',
          status: 'completed',
          category: item.category || 'direct',
          created_at: item.created_at
        });
      });
    }

    // 2. Deposits — only show PENDING and REJECTED from the raw deposits table.
    // Approved/completed deposits are already in the activities table (inserted by admin_process_deposit RPC).
    // Showing them here too would cause duplicates in the activity feed.
    if (depRes.status === 'fulfilled' && depRes.value.data) {
      depRes.value.data.forEach(dep => {
        const st = (dep.status || 'pending').toLowerCase();

        // Skip approved/completed — already shown via activities table
        if (st === 'approved' || st === 'completed') return;

        let detailText = '';
        let titleText = 'Wallet Deposit';
        if (st === 'pending') {
          titleText = 'Deposit Pending';
          detailText = `BEP-20 USDT Deposit of $${parseFloat(dep.amount).toFixed(2)} — Awaiting admin approval`;
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

    // 3. Withdrawals
    if (withRes.status === 'fulfilled' && withRes.value.data) {
      withRes.value.data.forEach(w => {
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

    // 4. Package Purchases
    if (pkgRes.status === 'fulfilled' && pkgRes.value.data) {
      pkgRes.value.data.forEach(p => {
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

    // 5. Reward Claims
    if (rewardRes.status === 'fulfilled' && rewardRes.value.data) {
      rewardRes.value.data.forEach(r => {
        combinedList.push({
          id: r.id,
          title: 'Reward Claimed',
          details: `Reward Level ${r.reward_level || 1} Payout`,
          amount: parseFloat(r.reward_amount) || 0,
          type: 'reward',
          status: 'completed',
          category: 'reward',
          created_at: r.claimed_at || r.created_at
        });
      });
    }

    // 6. Team Income Log (Direct Feed & Pass-Up Notifications)
    if (teamRes.status === 'fulfilled' && teamRes.value.data) {
      teamRes.value.data.forEach(t => {
        // Prevent duplicate if already in activities table
        const isDuplicate = combinedList.some(item => 
          item.category === 'team' && item.details && item.details.includes(`Position #${t.upline_position}`)
        );
        if (!isDuplicate) {
          const isPaid = (t.status || 'paid') === 'paid';
          combinedList.push({
            id: t.id,
            title: isPaid ? `Team Income (${t.commission_pct}%)` : 'Team Income Skipped',
            details: isPaid
              ? `${t.commission_pct}% Team Income ($${parseFloat(t.commission_amount || 0).toFixed(2)} USDT) from ${t.purchaser_username || 'Downline'} purchasing ${t.package_name || 'Rank'} (Position #${t.upline_position})`
              : `Skipped: Current rank (${t.recipient_rank || 'None'}) below required ${t.purchaser_rank} for purchase by ${t.purchaser_username || 'Downline'}. Passed up.`,
            amount: isPaid ? (parseFloat(t.commission_amount) || 0) : 0,
            type: isPaid ? 'income' : 'info',
            status: isPaid ? 'completed' : 'skipped',
            category: 'team',
            created_at: t.created_at
          });
        }
      });
    }

    // 7. Non-Working Income Distributions (Fallback for legacy paid records without activity entry)
    try {
      const { data: nwData } = await client
        .from('non_working_distributions')
        .select('*')
        .eq('recipient_user_id', userId)
        .eq('status', 'paid') // ONLY paid records! Never claimable or unallocated
        .order('distributed_at', { ascending: false })
        .limit(limit);

      if (nwData && nwData.length > 0) {
        nwData.forEach(nw => {
          const isDup = combinedList.some(item =>
            item.category === 'non_working' && item.details && item.details.includes(`Pool #${nw.pool_num}`)
          );
          if (!isDup) {
            combinedList.push({
              id: nw.id,
              title: `Non-Working Income Claimed ✅`,
              details: `Level ${nw.level} Pool #${nw.pool_num} — $${parseFloat(nw.amount || 0).toFixed(2)} USDT credited to your wallet`,
              amount: parseFloat(nw.amount) || 0,
              type: 'income',
              status: 'completed',
              category: 'non_working',
              created_at: nw.distributed_at
            });
          }
        });
      }
    } catch (_) {}

  } catch (e) {
    console.warn('Activities parallel fetch note:', e);
  }

  // Sort unified transaction activities chronologically (newest first)
  combinedList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return combinedList.slice(0, limit);
}

/**
 * Calculates dynamic Today's Income based on actual transaction timestamps (since 00:00:00 today).
 * At 12:00 AM, this automatically resets to 0.00 without deleting any historical transactions.
 */
async function getUserTodayIncome(userId) {
  const client = getSupabase();
  if (!client || !userId) return 0;

  try {
    // 1. Try PostgreSQL RPC function first
    const { data, error } = await client.rpc('get_user_today_income', { p_user_id: userId });
    if (!error && data !== null && data !== undefined) {
      return parseFloat(data) || 0;
    }
  } catch (_) {}

  // 2. Fallback: Query activities created since today midnight local/UTC
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfTodayIso = today.toISOString();

    const { data: actData } = await client
      .from('activities')
      .select('amount')
      .eq('user_id', userId)
      .gt('amount', 0)
      .eq('type', 'income')
      .in('category', ['direct', 'team', 'non_working', 'reward', 'income'])
      .gte('created_at', startOfTodayIso);

    if (actData && actData.length > 0) {
      const sum = actData.reduce((acc, row) => acc + (parseFloat(row.amount) || 0), 0);
      return parseFloat(sum.toFixed(2));
    }
  } catch (e) {
    console.warn('Today income calculation note:', e);
  }

  return 0;
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
  verifyPasswordOtp,
  updateUserPassword,
  getUserProfile,
  getUserActivities,
  getUserTodayIncome,
  signOutUser,
  onAuthStateChanged,
  getCurrentUser
};
