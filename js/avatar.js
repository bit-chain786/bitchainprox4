/* ==========================================================================
   BITCHAIN PRO X — USER-SPECIFIC GLOBAL AVATAR SYSTEM
   Ensures 100% user-scoped profile photo isolation.
   - Account A's photo is tied ONLY to Account A (user.id).
   - Account B's photo is tied ONLY to Account B (user.id).
   - Never shares or leaks avatar cache between different accounts.
   - Cleanly resets UI to user's initial when an account has no custom photo.
   ========================================================================== */

(function () {
  'use strict';

  // Helper to generate a user-specific cache key
  function getCacheKey(userId) {
    return userId ? `bitchain_avatar_url_${userId}` : null;
  }
  function getCacheTsKey(userId) {
    return userId ? `bitchain_avatar_ts_${userId}` : null;
  }
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Clean legacy/global non-user-specific keys if they exist
  try {
    localStorage.removeItem('bitchain_avatar_url');
    localStorage.removeItem('bitchain_avatar_ts');
  } catch (e) {}

  /* -----------------------------------------------------------------------
     Apply profile photo to all avatar elements on the current page
  ----------------------------------------------------------------------- */
  function applyAvatarEverywhere(url) {
    if (!url) return;
    const cacheBustedUrl = url.includes('?t=') ? url : `${url}?t=${Date.now()}`;

    // 1. Navbar avatar circle (#navAvatarCircle)
    const navCircle = document.getElementById('navAvatarCircle');
    if (navCircle) {
      navCircle.style.backgroundImage = `url('${cacheBustedUrl}')`;
      navCircle.style.backgroundSize = 'cover';
      navCircle.style.backgroundPosition = 'center';
      navCircle.style.color = 'transparent';
      navCircle.textContent = '';
    }

    // 2. Dashboard large profile card avatar (#profAvatarInitial)
    const profCircle = document.getElementById('profAvatarInitial');
    if (profCircle) {
      profCircle.style.backgroundImage = `url('${cacheBustedUrl}')`;
      profCircle.style.backgroundSize = 'cover';
      profCircle.style.backgroundPosition = 'center';
      profCircle.style.color = 'transparent';
      profCircle.textContent = '';
    }

    // 3. Any element with class .global-avatar-target
    document.querySelectorAll('.global-avatar-target').forEach(el => {
      el.style.backgroundImage = `url('${cacheBustedUrl}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.color = 'transparent';
      el.textContent = '';
    });
  }

  /* -----------------------------------------------------------------------
     Reset avatar elements to default state (initial letter)
  ----------------------------------------------------------------------- */
  function resetAvatarEverywhere(initialLetter) {
    const letter = (initialLetter || '').toUpperCase();

    // 1. Navbar avatar circle
    const navCircle = document.getElementById('navAvatarCircle');
    if (navCircle) {
      navCircle.style.backgroundImage = 'none';
      navCircle.style.color = '';
      if (letter) navCircle.textContent = letter;
    }

    // 2. Dashboard profile card avatar
    const profCircle = document.getElementById('profAvatarInitial');
    if (profCircle) {
      profCircle.style.backgroundImage = 'none';
      profCircle.style.color = '';
      if (letter) profCircle.textContent = letter;
    }

    // 3. Any element with class .global-avatar-target
    document.querySelectorAll('.global-avatar-target').forEach(el => {
      el.style.backgroundImage = 'none';
      el.style.color = '';
      if (letter) el.textContent = letter;
    });
  }

  /* -----------------------------------------------------------------------
     Load avatar for the CURRENT authenticated user only
  ----------------------------------------------------------------------- */
  async function loadGlobalAvatar(forceRefresh) {
    try {
      const client = window.BitchainAuth && window.BitchainAuth.getSupabase
        ? window.BitchainAuth.getSupabase()
        : null;
      if (!client) return;

      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        // No user logged in -> clear all avatars
        resetAvatarEverywhere('');
        return;
      }

      const userCacheKey = getCacheKey(user.id);
      const userCacheTsKey = getCacheTsKey(user.id);

      // Check user-scoped cache first if not forced refresh
      if (!forceRefresh && userCacheKey) {
        const cached = localStorage.getItem(userCacheKey);
        const ts = parseInt(localStorage.getItem(userCacheTsKey) || '0');
        if (cached && (Date.now() - ts < CACHE_TTL)) {
          applyAvatarEverywhere(cached);
          return;
        }
      }

      // Fetch fresh profile record from Supabase for this specific user ID
      const { data: profile, error } = await client
        .from('profiles')
        .select('avatar_url, full_name, username')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.warn('Avatar profile query note:', error.message);
        return;
      }

      const fallbackName = (profile && profile.full_name) || (profile && profile.username) || (user.email ? user.email.split('@')[0] : 'U');
      const initial = fallbackName.charAt(0).toUpperCase();

      if (profile && profile.avatar_url && profile.avatar_url.trim() !== '') {
        // User has a photo -> Cache with user-specific key and apply
        if (userCacheKey) {
          localStorage.setItem(userCacheKey, profile.avatar_url);
          localStorage.setItem(userCacheTsKey, Date.now().toString());
        }
        applyAvatarEverywhere(profile.avatar_url);
      } else {
        // User has NO photo -> Clear user cache and reset UI to user's initial
        if (userCacheKey) {
          localStorage.removeItem(userCacheKey);
          localStorage.removeItem(userCacheTsKey);
        }
        resetAvatarEverywhere(initial);
      }
    } catch (e) {
      console.warn('GlobalAvatar load error:', e);
    }
  }

  /* -----------------------------------------------------------------------
     Public API
  ----------------------------------------------------------------------- */
  window.GlobalAvatar = {
    /**
     * Force refresh the avatar from Supabase for current user
     */
    refresh: function () {
      loadGlobalAvatar(true);
    },

    /**
     * Immediately apply a user-specific photo URL
     */
    apply: function (url, userId) {
      if (!url) return;
      if (userId) {
        localStorage.setItem(getCacheKey(userId), url);
        localStorage.setItem(getCacheTsKey(userId), Date.now().toString());
      }
      applyAvatarEverywhere(url);
    },

    /**
     * Reset UI and purge avatar cache for specified user or all users
     */
    clear: function (userId) {
      if (userId) {
        localStorage.removeItem(getCacheKey(userId));
        localStorage.removeItem(getCacheTsKey(userId));
      } else {
        // Clear all avatar cache items from localStorage
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('bitchain_avatar_')) {
            localStorage.removeItem(key);
          }
        });
      }
      resetAvatarEverywhere('');
    }
  };

  /* -----------------------------------------------------------------------
     Auto-initialization on page ready & auth state changes
  ----------------------------------------------------------------------- */
  function initAvatarWatcher() {
    loadGlobalAvatar(false);
    setTimeout(() => loadGlobalAvatar(false), 800);
    setTimeout(() => loadGlobalAvatar(false), 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAvatarWatcher);
  } else {
    initAvatarWatcher();
  }

})();
