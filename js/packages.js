/* ==========================================================================
   BITCHAIN PRO X — PACKAGE / RANK UPGRADE SYSTEM
   Sequential Progression Engine with Supabase Integration
   ========================================================================== */

'use strict';

// ─── Package definitions (canonical — frontend never determines price) ───────
const PKG_TIERS = [
  { id: 1, key: 'starter',   name: 'STARTER',   rank: 'Starter',   price: 5,   icon: '🌱' },
  { id: 2, key: 'basic',     name: 'BASIC',     rank: 'Basic',     price: 10,  icon: '⚡' },
  { id: 3, key: 'silver',    name: 'SILVER',    rank: 'Silver',    price: 20,  icon: '🥈' },
  { id: 4, key: 'gold',      name: 'GOLD',      rank: 'Gold',      price: 40,  icon: '🥇' },
  { id: 5, key: 'diamond',   name: 'DIAMOND',   rank: 'Diamond',   price: 80,  icon: '💎' },
  { id: 6, key: 'elite',     name: 'ELITE',     rank: 'Elite',     price: 160, icon: '👑' },
  { id: 7, key: 'executive', name: 'EXECUTIVE', rank: 'Executive', price: 320, icon: '🏆' },
  { id: 8, key: 'royal',     name: 'ROYAL',     rank: 'Royal',     price: 640, icon: '💠' }
];

// ─── State ───────────────────────────────────────────────────────────────────
let pkgPanelOpen = false;
let pkgCurrentIndex = -1;   // -1 = no package; 0..7 = index into PKG_TIERS
let pkgPendingIndex = null; // index of package being confirmed
let pkgUserId = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getSupabase() {
  return window.BitchainAuth && typeof window.BitchainAuth.getSupabase === 'function'
    ? window.BitchainAuth.getSupabase()
    : null;
}

function pkgShowToast(msg, type = 'success') {
  let t = document.getElementById('pkgToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'pkgToast';
    t.className = 'pkg-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'pkg-toast ' + type;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => t.classList.add('show'));
  });
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3600);
}

// ─── Determine current package index from DB value ───────────────────────────
function pkgKeyToIndex(pkgKey) {
  if (!pkgKey) return -1;
  const idx = PKG_TIERS.findIndex(p => p.key === pkgKey.toLowerCase().trim());
  return idx; // -1 if not found
}

// ─── Load user's current package from Supabase ───────────────────────────────
async function pkgLoadUserState() {
  // Always render defaults first so UI is never stuck on "Loading…"
  pkgUpdateCardDisplay();
  pkgRenderPanel();

  const client = getSupabase();
  if (!client) return;

  try {
    const { data: { user }, error: authErr } = await client.auth.getUser();
    if (authErr || !user) return;
    pkgUserId = user.id;

    const { data: profile, error } = await client
      .from('profiles')
      .select('current_package, current_rank')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      // If column doesn't exist yet (SQL not run), just show defaults gracefully
      console.warn('pkg load error (column may not exist yet):', error.message);
      return;
    }

    const rawPkg = (profile && profile.current_package) || null;
    pkgCurrentIndex = pkgKeyToIndex(rawPkg);

    // Sync display with real DB values
    pkgUpdateCardDisplay();
  } catch (e) {
    console.warn('pkgLoadUserState exception:', e);
    // Still safe — defaults were already rendered above
  }
}

// ─── Update the card's Current Package / Rank display ───────────────────────
function pkgUpdateCardDisplay() {
  const badgeEl = document.getElementById('profUserRankBadge');
  
  const curNameEl = document.getElementById('pkgCurrentName');
  const curPriceEl = document.getElementById('pkgCurrentPrice');
  const curIconEl = document.getElementById('pkgCurrentIcon');
  
  const nextNameEl = document.getElementById('pkgNextName');
  const nextPriceEl = document.getElementById('pkgNextPrice');
  const nextIconEl = document.getElementById('pkgNextIcon');
  
  const btnEl = document.getElementById('pkgUpgradeTriggerBtn');
  const btnTextEl = document.getElementById('pkgUpgradeBtnText');
  const arrowCenter = document.getElementById('upgradeArrowCenter');
  const nextSide = document.getElementById('upgradeNextSide');
  const actionBottom = document.getElementById('upgradeActionBottom');

  if (pkgCurrentIndex < 0) {
    // Do NOT overwrite rank badge here — rank is set by the dashboard from the real DB value
    // if (badgeEl) badgeEl.textContent = '✦ UNRANKED';  // managed by dashboard.html
    if (curNameEl) curNameEl.textContent = 'No Package';
    if (curPriceEl) curPriceEl.textContent = '';
    if (curIconEl) curIconEl.textContent = '🛡️';
    
    const nextTier = PKG_TIERS[0];
    if (nextNameEl) nextNameEl.textContent = nextTier.name;
    if (nextPriceEl) nextPriceEl.textContent = '$' + nextTier.price;
    if (nextIconEl) nextIconEl.textContent = nextTier.icon;
    
    if (btnTextEl) btnTextEl.textContent = `PURCHASE ${nextTier.name} — $${nextTier.price}`;
    if (btnEl) {
      btnEl.setAttribute('onclick', `pkgOpenConfirm(0)`);
      btnEl.style.display = 'flex';
    }
    
    if(arrowCenter) arrowCenter.style.display = 'flex';
    if(nextSide) nextSide.style.display = 'flex';
    if(actionBottom) actionBottom.style.display = 'block';
  } else {
    const currentTier = PKG_TIERS[pkgCurrentIndex];
    if (badgeEl) badgeEl.textContent = '✦ ' + currentTier.rank.toUpperCase();
    if (curNameEl) curNameEl.textContent = currentTier.name;
    if (curPriceEl) curPriceEl.textContent = '$' + currentTier.price;
    if (curIconEl) curIconEl.textContent = currentTier.icon;
    
    if (pkgCurrentIndex >= PKG_TIERS.length - 1) {
      // Max Achieved
      if(arrowCenter) arrowCenter.style.display = 'none';
      if(nextSide) nextSide.style.display = 'none';
      if(actionBottom) actionBottom.style.display = 'none';
      
      if (curNameEl) curNameEl.textContent = currentTier.name + ' (MAX)';
      if (curPriceEl) {
        curPriceEl.textContent = 'You have reached the highest available package.';
        curPriceEl.style.fontSize = '0.85rem';
        curPriceEl.style.color = '#c77dff';
      }
    } else {
      const nextTier = PKG_TIERS[pkgCurrentIndex + 1];
      if (nextNameEl) nextNameEl.textContent = nextTier.name;
      if (nextPriceEl) nextPriceEl.textContent = '$' + nextTier.price;
      if (nextIconEl) nextIconEl.textContent = nextTier.icon;
      
      if (btnTextEl) btnTextEl.textContent = `UPGRADE TO ${nextTier.name} — $${nextTier.price}`;
      if (btnEl) {
        btnEl.setAttribute('onclick', `pkgOpenConfirm(${pkgCurrentIndex + 1})`);
        btnEl.style.display = 'flex';
      }
      
      if(arrowCenter) arrowCenter.style.display = 'flex';
      if(nextSide) nextSide.style.display = 'flex';
      if(actionBottom) actionBottom.style.display = 'block';
      if(curPriceEl) {
        curPriceEl.style.fontSize = '1.05rem';
        curPriceEl.style.color = '#e0aaff';
      }
    }
  }
}

// ─── Open confirmation modal ─────────────────────────────────────────────────
async function pkgOpenConfirm(idx) {
  if (idx !== pkgCurrentIndex + 1) {
    if (idx <= pkgCurrentIndex) {
      pkgShowToast('This package is already achieved.', 'warning');
    } else {
      pkgShowToast('🔒 Complete the previous package first.', 'error');
    }
    return;
  }

  const btn = document.getElementById('pkgUpgradeTriggerBtn');
  if (btn) btn.innerHTML = '<span class="pkg-spinner"></span> Checking...';

  pkgPendingIndex = idx;
  const tier = PKG_TIERS[idx];
  const currentTier = pkgCurrentIndex >= 0 ? PKG_TIERS[pkgCurrentIndex] : null;
  const canonicalPrice = tier.price;
  
  let availableBal = 0;
  
  try {
    const client = getSupabase();
    if (client && pkgUserId) {
      const { data: profile } = await client
        .from('profiles')
        .select('available_balance')
        .eq('id', pkgUserId)
        .maybeSingle();
      if (profile && profile.available_balance) {
        availableBal = parseFloat(profile.available_balance) || 0;
      }
    }
  } catch(e) {
    console.warn("Could not fetch balance", e);
  }

  if (btn) btn.innerHTML = `<span class="btn-icon">⚡</span> <span id="pkgUpgradeBtnText">${currentTier ? 'UPGRADE TO ' : 'PURCHASE '} ${tier.name} — $${tier.price}</span>`;

  // Populate modal
  const el = (id) => document.getElementById(id);
  if (el('pkgConfirmPackageName'))  el('pkgConfirmPackageName').textContent  = tier.name;
  if (el('pkgConfirmPrice'))        el('pkgConfirmPrice').textContent        = '$' + tier.price + ' USDT';
  if (el('pkgConfirmCurrentPkg'))   el('pkgConfirmCurrentPkg').textContent   = currentTier ? currentTier.name : 'None';
  if (el('pkgConfirmNewPkg'))       el('pkgConfirmNewPkg').textContent       = tier.name;
  if (el('pkgConfirmIcon'))         el('pkgConfirmIcon').textContent         = tier.icon;
  
  const confirmBtn = document.getElementById('pkgConfirmBtn');
  const headingEl = document.getElementById('pkgConfirmHeading');
  const noteEl = document.querySelector('.pkg-confirm-note');
  
  if (availableBal < canonicalPrice) {
    // Insufficient Balance State
    if (headingEl) {
      headingEl.textContent = 'INSUFFICIENT BALANCE';
      headingEl.style.color = '#ff6b6b';
    }
    if (noteEl) {
      noteEl.innerHTML = `You need <b>$${canonicalPrice}</b> to upgrade to ${tier.name}.<br>Available Balance: <b>$${availableBal.toFixed(2)}</b><br>Required: <b>$${canonicalPrice.toFixed(2)}</b>`;
      noteEl.style.color = '#ff6b6b';
    }
    if (confirmBtn) {
      confirmBtn.textContent = 'ADD FUNDS';
      confirmBtn.style.background = 'linear-gradient(135deg, #e63946, #c1121f)';
      confirmBtn.onclick = () => { window.location.href = '#'; pkgCloseConfirm(); pkgShowToast('Redirecting to deposits...', 'warning'); };
    }
  } else {
    // Normal Confirmation State
    if (headingEl) {
      headingEl.textContent = 'Confirm Upgrade';
      headingEl.style.color = '#fff';
    }
    if (noteEl) {
      noteEl.textContent = 'This upgrade is final. Your package and rank will be updated immediately after confirmation.';
      noteEl.style.color = 'rgba(255,255,255,0.28)';
    }
    if (confirmBtn) {
      confirmBtn.textContent = 'Confirm Upgrade ⚡';
      confirmBtn.style.background = 'linear-gradient(135deg, #7b2cbf, #c77dff)';
      confirmBtn.onclick = pkgConfirmPurchase;
    }
  }

  const backdrop = document.getElementById('pkgConfirmBackdrop');
  if (backdrop) backdrop.classList.add('active');
}

function pkgCloseConfirm() {
  const backdrop = document.getElementById('pkgConfirmBackdrop');
  if (backdrop) backdrop.classList.remove('active');
  pkgPendingIndex = null;
}

// ─── Execute the purchase (server-validated) ─────────────────────────────────
async function pkgConfirmPurchase() {
  if (pkgPendingIndex === null) return;
  const idx = pkgPendingIndex;
  const tier = PKG_TIERS[idx];

  // Double-check sequential rule on client
  if (idx !== pkgCurrentIndex + 1) {
    pkgShowToast('🔒 Invalid upgrade sequence.', 'error');
    return;
  }

  const btn = document.getElementById('pkgConfirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="pkg-spinner"></span>Processing…';
  }

  try {
    const client = getSupabase();
    if (!client) throw new Error('Connection unavailable. Please refresh.');

    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('You must be signed in to upgrade.');

    // Fetch current profile to confirm current_package and available_balance
    const { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('current_package, available_balance')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr && profileErr.code !== 'PGRST116') {
      console.warn('Profile fetch warning:', profileErr.message);
    }

    const serverPkg = (profile && profile.current_package) || null;
    const serverCurrentIdx = pkgKeyToIndex(serverPkg);
    const availableBal = (profile && profile.available_balance) ? parseFloat(profile.available_balance) : 0;

    // Security check: sequence
    if (idx !== serverCurrentIdx + 1) {
      throw new Error('Package sequence violation. Please refresh the page.');
    }

    const canonicalPrice = PKG_TIERS[idx].price;

    // Security check: balance
    if (availableBal < canonicalPrice) {
      throw new Error('Insufficient balance to complete upgrade.');
    }

    // Deduct balance securely
    const newBalance = availableBal - canonicalPrice;

    // Record the purchase
    try {
      await client
        .from('package_purchases')
        .insert({
          user_id:      user.id,
          package_key:  tier.key,
          package_name: tier.name,
          rank_name:    tier.rank,
          amount:       canonicalPrice,
          status:       'completed',
          purchased_at: new Date().toISOString()
        });
    } catch (_) { }

    // Update the user's profile with new package + rank AND DEDUCT BALANCE
    const { error: updateErr } = await client
      .from('profiles')
      .update({
        current_package: tier.key,
        current_rank:    tier.rank,
        available_balance: newBalance,
        updated_at:      new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateErr) throw new Error('Failed to update your package: ' + updateErr.message);

    // Record activity
    try {
      await client.from('activities').insert({
        user_id:     user.id,
        type:        'package_upgrade',
        title:       `Upgraded to ${tier.name}`,
        description: `Package upgraded to ${tier.name} (-$${canonicalPrice} USDT)`,
        amount:      -canonicalPrice,
        created_at:  new Date().toISOString()
      });
    } catch (_) { }

    // Update local state
    pkgCurrentIndex = idx;
    pkgCloseConfirm();

    // Update card display
    pkgUpdateCardDisplay();
    
    // Globally update the available balance if loadProfileData exists
    if (typeof loadProfileData === 'function') {
      loadProfileData(); 
    } else {
      // Just visually update the dashboard elements if loadProfileData isn't exposed
      const balEls = document.querySelectorAll('#valAvailableBal, #dashAvailBal');
      balEls.forEach(el => {
        el.textContent = '$' + newBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      });
    }

    // Show congratulations popup
    pkgShowCongrats(tier, canonicalPrice);

  } catch (err) {
    console.error('Package upgrade error:', err);
    pkgShowToast('⚠ ' + (err.message || 'Upgrade failed. Please try again.'), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirm Upgrade ⚡';
    }
  }
}

// ─── Congratulations popup ────────────────────────────────────────────────────
function pkgShowCongrats(tier, price) {
  const el = (id) => document.getElementById(id);
  if (el('pkgCongratsIcon'))    el('pkgCongratsIcon').textContent  = tier.icon;
  if (el('pkgCongratsTitle'))   el('pkgCongratsTitle').textContent = '🎉 CONGRATULATIONS! 🎉';
  if (el('pkgCongratsWelcome')) el('pkgCongratsWelcome').textContent = 'WELCOME TO ' + tier.name;
  if (el('pkgCongratsPackage')) el('pkgCongratsPackage').textContent = tier.name;
  if (el('pkgCongratsValue'))   el('pkgCongratsValue').textContent  = '$' + price + ' USDT';

  const backdrop = document.getElementById('pkgCongratsBackdrop');
  if (backdrop) backdrop.classList.add('active');

  // Run particle effect
  pkgRunCongratsParticles();
}

function pkgCloseCongrats() {
  const backdrop = document.getElementById('pkgCongratsBackdrop');
  if (backdrop) backdrop.classList.remove('active');
  // Cancel particle loop
  if (window._pkgParticleRaf) {
    cancelAnimationFrame(window._pkgParticleRaf);
    window._pkgParticleRaf = null;
  }
}

// ─── Subtle particle animation for congratulations ────────────────────────────
function pkgRunCongratsParticles() {
  const canvas = document.getElementById('congratsParticles');
  if (!canvas) return;

  const card = document.querySelector('.pkg-congrats-card');
  if (card) {
    canvas.width  = card.offsetWidth;
    canvas.height = card.offsetHeight;
  }

  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = ['#c77dff','#e0aaff','#9d4edd','#7b2cbf','#06d6a0','#ffd166','#ffffff'];

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: canvas.height + 10,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -(Math.random() * 2.5 + 0.8),
      radius: Math.random() * 2.5 + 0.8,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      decay: Math.random() * 0.012 + 0.006
    };
  }

  for (let i = 0; i < 25; i++) {
    const p = createParticle();
    p.y = Math.random() * canvas.height;
    particles.push(p);
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (Math.random() < 0.35) particles.push(createParticle());

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      if (p.alpha <= 0) { particles.splice(i, 1); continue; }

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Keep max 60 particles for performance
    if (particles.length > 60) particles.splice(0, particles.length - 60);

    window._pkgParticleRaf = requestAnimationFrame(loop);
  }

  if (window._pkgParticleRaf) cancelAnimationFrame(window._pkgParticleRaf);
  loop();
}

// ─── Bootstrap: wait for auth then load state ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Render defaults immediately — no more stuck "Loading…"
  pkgUpdateCardDisplay();

  // Then try to load real data from Supabase after auth is ready
  setTimeout(pkgLoadUserState, 600);

  // Retry once more in case auth took longer
  setTimeout(() => {
    if (pkgUserId === null) pkgLoadUserState();
  }, 2500);
});

