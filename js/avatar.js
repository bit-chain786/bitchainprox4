/* ==========================================================================
   BITCHAIN PRO X — GLOBAL AVATAR LOADER
   Runs on every page. Fetches avatar_url from Supabase profiles table
   and applies the profile photo to ALL avatar elements across the site:
     - Navbar top-right circle (#navAvatarCircle)
     - Dashboard profile card (#profAvatarInitial)
     - Any element with class .global-avatar-target
   ========================================================================== */

(function () {
  'use strict';

  // Cache key so we don't re-fetch on every page navigation
  const CACHE_KEY = 'bitchain_avatar_url';
  const CACHE_TS_KEY = 'bitchain_avatar_ts';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /* -----------------------------------------------------------------------
     Apply a photo URL to every known avatar spot on the current page
  ----------------------------------------------------------------------- */
  function applyAvatarEverywhere(url) {
    if (!url) return;

    const cacheBustedUrl = url.includes('?t=') ? url : url + '?t=' + Date.now();

    // 1. Navbar circle badge (rendered by auth.js as #navAvatarCircle)
    const navCircle = document.getElementById('navAvatarCircle');
    if (navCircle) {
      navCircle.style.backgroundImage = `url('${cacheBustedUrl}')`;
      navCircle.style.backgroundSize = 'cover';
      navCircle.style.backgroundPosition = 'center';
      navCircle.style.color = 'transparent';
      navCircle.textContent = '';
    }

    // 2. Dashboard large profile avatar (#profAvatarInitial)
    const profCircle = document.getElementById('profAvatarInitial');
    if (profCircle) {
      profCircle.style.backgroundImage = `url('${cacheBustedUrl}')`;
      profCircle.style.backgroundSize = 'cover';
      profCircle.style.backgroundPosition = 'center';
      profCircle.style.color = 'transparent';
      profCircle.textContent = '';
    }

    // 3. Any other element tagged with class "global-avatar-target"
    document.querySelectorAll('.global-avatar-target').forEach(el => {
      el.style.backgroundImage = `url('${cacheBustedUrl}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.color = 'transparent';
      el.textContent = '';
    });
  }

  /* -----------------------------------------------------------------------
     Load avatar_url from Supabase (with local cache)
  ----------------------------------------------------------------------- */
  async function loadGlobalAvatar(forceRefresh) {
    try {
      // Check local cache first (unless forced refresh)
      if (!forceRefresh) {
        const cached = localStorage.getItem(CACHE_KEY);
        const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
        if (cached && (Date.now() - ts < CACHE_TTL)) {
          applyAvatarEverywhere(cached);
          return;
        }
      }

      // Get Supabase client
      const client = window.BitchainAuth && window.BitchainAuth.getSupabase
        ? window.BitchainAuth.getSupabase()
        : null;
      if (!client) return;

      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      const { data: profile } = await client
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .single();

      if (profile && profile.avatar_url) {
        // Cache it
        localStorage.setItem(CACHE_KEY, profile.avatar_url);
        localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
        applyAvatarEverywhere(profile.avatar_url);
      }
    } catch (e) {
      // Silent fail — avatar is cosmetic
    }
  }

  /* -----------------------------------------------------------------------
     Public API — exposed on window so dashboard.html can call it after upload
  ----------------------------------------------------------------------- */
  window.GlobalAvatar = {
    /**
     * Force-refresh avatar from Supabase and apply to all spots
     */
    refresh: function () {
      loadGlobalAvatar(true);
    },

    /**
     * Immediately apply a URL to all spots (called right after upload,
     * no network round-trip needed)
     */
    apply: function (url) {
      // Bust the cache so next page load re-fetches
      localStorage.setItem(CACHE_KEY, url);
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
      applyAvatarEverywhere(url);
    },

    /**
     * Clear cached avatar (e.g. on logout)
     */
    clear: function () {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TS_KEY);
    }
  };

  /* -----------------------------------------------------------------------
     Auto-run: wait for auth.js to finish rendering the navbar, then apply
  ----------------------------------------------------------------------- */
  function waitForAuthAndApply() {
    // Try immediately
    loadGlobalAvatar(false);

    // Also retry after 1s and 2.5s to cover slow auth render
    setTimeout(() => loadGlobalAvatar(false), 1000);
    setTimeout(() => loadGlobalAvatar(false), 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForAuthAndApply);
  } else {
    waitForAuthAndApply();
  }

})();
