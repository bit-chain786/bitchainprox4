/* ==========================================================================
   BITCHAIN PRO X — PACKAGE / RANK UPGRADE SYSTEM
   Sequential Progression Engine with Live Supabase Balance Synchronization
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
let isPurchasing = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getSupabase() {
  return window.BitchainAuth && typeof window.BitchainAuth.getSupabase === 'function'
    ? window.BitchainAuth.getSupabase()
    : null;
}

/**
 * Gets the authoritative active user ID from session / auth
 */
async function getActiveUserId() {
  if (pkgUserId) return pkgUserId;
  const client = getSupabase();
  if (!client) return null;

  try {
    const { data: { session } } = await client.auth.getSession();
    if (session?.user?.id) {
      pkgUserId = session.user.id;
      return pkgUserId;
    }
    const { data: { user } } = await client.auth.getUser();
    if (user?.id) {
      pkgUserId = user.id;
      return pkgUserId;
    }
  } catch (e) {
    console.warn('Error getting active user ID:', e);
  }
  return null;
}

/**
 * Gets the authoritative available balance from Supabase / Dashboard sync
 */
async function getAuthoritativeBalance(userId) {
  let bal = 0;
  const client = getSupabase();

  if (userId && window.BitchainAuth && typeof window.BitchainAuth.getUserProfile === 'function') {
    try {
      const profile = await window.BitchainAuth.getUserProfile(userId);
      if (profile && profile.available_balance !== null && profile.available_balance !== undefined) {
        bal = parseFloat(profile.available_balance);
        if (!isNaN(bal)) return bal;
      }
    } catch (e) {}
  }

  if (userId && client) {
    try {
      const { data: profile } = await client
        .from('profiles')
        .select('available_balance')
        .eq('id', userId)
        .maybeSingle();
      if (profile && profile.available_balance !== null && profile.available_balance !== undefined) {
        bal = parseFloat(profile.available_balance);
        if (!isNaN(bal)) return bal;
      }
    } catch (e) {}
  }

  // DOM Fallback check if already rendered on the dashboard
  const mainBalEl = document.getElementById('walletMainBalance');
  if (mainBalEl && mainBalEl.textContent) {
    const domVal = parseFloat(mainBalEl.textContent.replace(/[^0-9.]/g, ''));
    if (!isNaN(domVal) && domVal > 0) return domVal;
  }

  const availBalEl = document.getElementById('valAvailableBal');
  if (availBalEl && availBalEl.textContent) {
    const domVal = parseFloat(availBalEl.textContent.replace(/[^0-9.]/g, ''));
    if (!isNaN(domVal) && domVal > 0) return domVal;
  }

  return bal;
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
  const idx = PKG_TIERS.findIndex(p => p.key === pkgKey.toLowerCase().trim() || p.name.toLowerCase() === pkgKey.toLowerCase().trim() || p.rank.toLowerCase() === pkgKey.toLowerCase().trim());
  return idx; // -1 if not found
}

// ─── Load user's current package from Supabase ───────────────────────────────
async function pkgLoadUserState() {
  pkgUpdateCardDisplay();
  pkgRenderPanel();

  const client = getSupabase();
  if (!client) return;

  try {
    const userId = await getActiveUserId();
    if (!userId) return;

    let profile = null;
    if (window.BitchainAuth && typeof window.BitchainAuth.getUserProfile === 'function') {
      profile = await window.BitchainAuth.getUserProfile(userId);
    }
    if (!profile) {
      const { data } = await client
        .from('profiles')
        .select('current_package, current_rank, rank, rank_value, available_balance')
        .eq('id', userId)
        .maybeSingle();
      profile = data;
    }

    const rawPkg = (profile && (profile.current_package || profile.current_rank)) || null;
    pkgCurrentIndex = pkgKeyToIndex(rawPkg);

    if (pkgCurrentIndex < 0 && profile && profile.rank_value > 0) {
      pkgCurrentIndex = Math.min(PKG_TIERS.length - 1, profile.rank_value - 1);
    }

    pkgUpdateCardDisplay();
    pkgRenderPanel();
  } catch (e) {
    console.warn('pkgLoadUserState exception:', e);
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

// ─── Open confirmation modal with LIVE Supabase balance check ────────────────
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
  if (btn) btn.innerHTML = '<span class="pkg-spinner"></span> Checking Balance...';

  pkgPendingIndex = idx;
  const tier = PKG_TIERS[idx];
  const currentTier = pkgCurrentIndex >= 0 ? PKG_TIERS[pkgCurrentIndex] : null;
  const canonicalPrice = tier.price;
  
  // Resolve user and balance synchronously with the exact same Supabase engine
  const userId = await getActiveUserId();
  const availableBal = await getAuthoritativeBalance(userId);

  if (btn) btn.innerHTML = `<span class="btn-icon">⚡</span> <span id="pkgUpgradeBtnText">${currentTier ? 'UPGRADE TO ' : 'PURCHASE '} ${tier.name} — $${tier.price}</span>`;

  // Populate modal fields
  const el = (id) => document.getElementById(id);
  if (el('pkgConfirmPackageName')) el('pkgConfirmPackageName').textContent = tier.name;
  if (el('pkgConfirmPrice'))       el('pkgConfirmPrice').textContent       = '$' + tier.price.toFixed(2) + ' USDT';
  if (el('pkgConfirmAvailBal'))    el('pkgConfirmAvailBal').textContent    = '$' + availableBal.toFixed(2) + ' USDT';
  if (el('pkgConfirmCurrentPkg'))  el('pkgConfirmCurrentPkg').textContent  = currentTier ? currentTier.name : 'None';
  if (el('pkgConfirmNewPkg'))      el('pkgConfirmNewPkg').textContent      = tier.name;
  if (el('pkgConfirmIcon'))        el('pkgConfirmIcon').textContent        = tier.icon;
  
  const confirmBtn = document.getElementById('pkgConfirmBtn');
  const headingEl  = document.getElementById('pkgConfirmHeading');
  const noteEl     = document.querySelector('.pkg-confirm-note');
  
  if (availableBal < canonicalPrice) {
    // Insufficient Balance State
    if (headingEl) {
      headingEl.textContent = 'INSUFFICIENT BALANCE';
      headingEl.style.color = '#ff6b6b';
    }
    if (noteEl) {
      noteEl.innerHTML = `Available Balance: <b style="color:#ff6b6b;">$${availableBal.toFixed(2)} USDT</b><br>Required: <b>$${canonicalPrice.toFixed(2)} USDT</b><br>Shortfall: <b>$${(canonicalPrice - availableBal).toFixed(2)} USDT</b>`;
      noteEl.style.color = '#ff6b6b';
    }
    if (confirmBtn) {
      confirmBtn.textContent = 'ADD FUNDS';
      confirmBtn.style.background = 'linear-gradient(135deg, #e63946, #c1121f)';
      confirmBtn.onclick = () => {
        pkgCloseConfirm();
        if (window.WalletModule && typeof window.WalletModule.openDepositModal === 'function') {
          window.WalletModule.openDepositModal();
        } else {
          window.location.href = '#dashWalletSection';
          pkgShowToast('Please deposit funds to continue.', 'warning');
        }
      };
      confirmBtn.disabled = false;
    }
  } else {
    // Sufficient Balance — Allow Upgrade
    if (headingEl) {
      headingEl.textContent = 'Confirm Upgrade';
      headingEl.style.color = '#ffffff';
    }
    if (noteEl) {
      noteEl.innerHTML = `Available Balance: <b style="color:#00f5d4;">$${availableBal.toFixed(2)} USDT</b> (Sufficient)<br>Amount to deduct: <b>$${canonicalPrice.toFixed(2)} USDT</b><br>Balance after upgrade: <b>$${(availableBal - canonicalPrice).toFixed(2)} USDT</b>`;
      noteEl.style.color = 'rgba(255,255,255,0.7)';
    }
    if (confirmBtn) {
      confirmBtn.textContent = `Confirm Upgrade ($${canonicalPrice.toFixed(2)} USDT) ⚡`;
      confirmBtn.style.background = 'linear-gradient(135deg, #7b2cbf, #c77dff)';
      confirmBtn.onclick = pkgConfirmPurchase;
      confirmBtn.disabled = false;
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

// ─── Execute the purchase (server-validated & atomic) ─────────────────────────
async function pkgConfirmPurchase() {
  if (pkgPendingIndex === null || isPurchasing) return;
  isPurchasing = true;

  const idx = pkgPendingIndex;
  const tier = PKG_TIERS[idx];

  // Double-check sequential rule on client
  if (idx !== pkgCurrentIndex + 1) {
    pkgShowToast('🔒 Invalid upgrade sequence.', 'error');
    isPurchasing = false;
    return;
  }

  const btn = document.getElementById('pkgConfirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="pkg-spinner"></span> Processing Upgrade…';
  }

  try {
    const client = getSupabase();
    if (!client) throw new Error('Connection unavailable. Please refresh.');

    const userId = await getActiveUserId();
    if (!userId) throw new Error('You must be signed in to upgrade.');

    // Fetch live profile from Supabase
    let profile = null;
    if (window.BitchainAuth && typeof window.BitchainAuth.getUserProfile === 'function') {
      profile = await window.BitchainAuth.getUserProfile(userId);
    }
    if (!profile) {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) throw new Error('Could not verify account balance. ' + error.message);
      profile = data;
    }

    const serverPkg = (profile && (profile.current_package || profile.current_rank)) || null;
    let serverCurrentIdx = pkgKeyToIndex(serverPkg);
    if (serverCurrentIdx < 0 && profile && profile.rank_value > 0) {
      serverCurrentIdx = Math.min(PKG_TIERS.length - 1, profile.rank_value - 1);
    }

    let availableBal = (profile && profile.available_balance !== null && profile.available_balance !== undefined)
      ? parseFloat(profile.available_balance)
      : 0;

    const canonicalPrice = tier.price;

    // In case profile returned 0, double-check getAuthoritativeBalance
    if (availableBal === 0) {
      availableBal = await getAuthoritativeBalance(userId);
    }

    // Security check: balance
    if (availableBal < canonicalPrice) {
      throw new Error(`Insufficient balance ($${availableBal.toFixed(2)} USDT available, $${canonicalPrice.toFixed(2)} required).`);
    }

    // Deduct balance
    const newBalance = Math.max(0, availableBal - canonicalPrice);

    // 1. Record the package purchase
    try {
      const { data: purchaseData, error: purchaseInsertErr } = await client
          .from('package_purchases')
          .insert({
            user_id:      userId,
            package_key:  tier.key,
            package_name: tier.name,
            rank_name:    tier.rank,
            amount:       canonicalPrice,
            status:       'completed',
            purchased_at: new Date().toISOString()
          })
          .select();
        if (purchaseInsertErr) {
          console.warn('Purchase log note:', purchaseInsertErr);
        }
        // ---- Direct Income Commission (40% of purchase) ----
        if (purchaseData && purchaseData.length > 0) {
          const purchaseId = purchaseData[0].id;
          // Get purchaser's sponsor username
          const { data: purchaserProfile } = await client
            .from('profiles')
            .select('sponsor_username, username')
            .eq('id', userId)
            .single();
          if (purchaserProfile && purchaserProfile.sponsor_username) {
            const rawSponsor = purchaserProfile.sponsor_username.trim();
            // Look up sponsor by referral_code, username, or email
            const { data: sponsorList } = await client
              .from('profiles')
              .select('id, direct_income, total_income, available_balance, username, full_name, referral_code, email')
              .or(`referral_code.ilike.${rawSponsor},username.ilike.${rawSponsor},email.ilike.${rawSponsor}`)
              .limit(1);

            const sponsorProfile = (sponsorList && sponsorList.length > 0) ? sponsorList[0] : null;

            if (sponsorProfile && sponsorProfile.id && sponsorProfile.id !== userId) {
              const commission = parseFloat((canonicalPrice * 0.4).toFixed(2));
              // Prevent duplicate commission for this purchase
              const { data: existing } = await client
                .from('activities')
                .select('id')
                .eq('user_id', sponsorProfile.id)
                .eq('title', 'Direct Income')
                .ilike('details', `%${purchaseId}%`)
                .limit(1);

              if (!existing || existing.length === 0) {
                // Log activity for sponsor
                await client.from('activities').insert({
                  user_id:    sponsorProfile.id,
                  title:      'Direct Income',
                  details:    `40% commission from ${purchaserProfile.username || 'Direct Referral'} purchasing ${tier.name} — $${canonicalPrice.toFixed(2)} USDT (Ref: ${purchaseId})`,
                  amount:     commission,
                  category:   'direct',
                  created_at: new Date().toISOString()
                });

                // Update sponsor's direct_income, total_income, and available_balance
                const curDirect = parseFloat(sponsorProfile.direct_income) || 0;
                const curTotal  = parseFloat(sponsorProfile.total_income) || 0;
                const curBal    = parseFloat(sponsorProfile.available_balance) || 0;

                await client.from('profiles').update({
                  direct_income:     parseFloat((curDirect + commission).toFixed(2)),
                  total_income:      parseFloat((curTotal + commission).toFixed(2)),
                  available_balance: parseFloat((curBal + commission).toFixed(2)),
                  updated_at:        new Date().toISOString()
                }).eq('id', sponsorProfile.id);
              }
            }
          }


        }

        // ---- Team Income (15% 5-Upline Leadership Distribution) ----
        if (purchaseData && purchaseData.length > 0) {
          const purchaseId = purchaseData[0].id;
          try {
            // Check if already processed
            const { data: existingTeamLogs } = await client
              .from('team_income_log')
              .select('id')
              .eq('purchase_id', purchaseId)
              .limit(1);

            if (!existingTeamLogs || existingTeamLogs.length === 0) {
              const rankOrder = { 'starter': 1, 'basic': 2, 'silver': 3, 'gold': 4, 'diamond': 5, 'elite': 6, 'executive': 7, 'royal': 8 };
              const purchaserRankKey = (tier.key || tier.rank || 'starter').toLowerCase();
              const purchaserRankLevel = rankOrder[purchaserRankKey] || 1;
              const percentages = [5, 4, 3, 2, 1];
              let qualifiedCount = 0;
              let currentUplineId = userId;
              const visitedIds = new Set([userId]);
              let loopSafety = 0;

              while (qualifiedCount < 5 && loopSafety < 100) {
                loopSafety++;
                // Get sponsor string of current user
                const { data: curProf } = await client
                  .from('profiles')
                  .select('sponsor_username')
                  .eq('id', currentUplineId)
                  .single();

                if (!curProf || !curProf.sponsor_username || !curProf.sponsor_username.trim()) break;

                const rawSponsor = curProf.sponsor_username.trim();
                const { data: sponsorList } = await client
                  .from('profiles')
                  .select('*')
                  .or(`referral_code.ilike.${rawSponsor},username.ilike.${rawSponsor},email.ilike.${rawSponsor}`)
                  .limit(1);

                if (!sponsorList || sponsorList.length === 0) break;
                const uplineProf = sponsorList[0];
                if (!uplineProf || visitedIds.has(uplineProf.id)) break;

                visitedIds.add(uplineProf.id);
                currentUplineId = uplineProf.id;

                const uplineRankKey = (uplineProf.current_rank || uplineProf.current_package || '').toLowerCase();
                const uplineRankLevel = rankOrder[uplineRankKey] || 0;

                if (uplineRankLevel >= purchaserRankLevel) {
                  // QUALIFIED
                  qualifiedCount++;
                  const pct = percentages[qualifiedCount - 1];
                  const comm = parseFloat((canonicalPrice * pct / 100).toFixed(2));

                  // Insert log
                  try {
                    await client.from('team_income_log').insert({
                      purchase_id: purchaseId,
                      purchaser_id: userId,
                      purchaser_username: purchaserProfile?.username || 'Member',
                      package_name: tier.name,
                      purchase_amount: canonicalPrice,
                      purchaser_rank: tier.rank,
                      purchaser_rank_level: purchaserRankLevel,
                      recipient_id: uplineProf.id,
                      recipient_username: uplineProf.username || 'Upline',
                      recipient_rank: uplineProf.current_rank || 'Starter',
                      recipient_rank_level: uplineRankLevel,
                      upline_position: qualifiedCount,
                      commission_pct: pct,
                      commission_amount: comm,
                      status: 'paid',
                      reason: `Qualified: Upline rank (${uplineProf.current_rank || 'Rank'}) >= Purchaser rank (${tier.rank})`,
                      created_at: new Date().toISOString()
                    });
                  } catch (_) {}

                  // Activity
                  try {
                    await client.from('activities').insert({
                      user_id: uplineProf.id,
                      type: 'income',
                      title: 'Team Income Received',
                      details: `${pct}% Team Income ($${comm.toFixed(2)} USDT) received from ${purchaserProfile?.username || 'Downline'} purchasing ${tier.name} (Qualified Position #${qualifiedCount})`,
                      amount: comm,
                      category: 'team',
                      created_at: new Date().toISOString()
                    });
                  } catch (_) {}

                  // Update balance
                  const curBal = parseFloat(uplineProf.available_balance) || 0;
                  const curTot = parseFloat(uplineProf.total_income) || 0;
                  const curTeam = parseFloat(uplineProf.team_income) || 0;
                  try {
                    await client.from('profiles').update({
                      available_balance: parseFloat((curBal + comm).toFixed(2)),
                      total_income: parseFloat((curTot + comm).toFixed(2)),
                      team_income: parseFloat((curTeam + comm).toFixed(2)),
                      updated_at: new Date().toISOString()
                    }).eq('id', uplineProf.id);
                  } catch (_) {}

                } else {
                  // SKIPPED
                  try {
                    await client.from('team_income_log').insert({
                      purchase_id: purchaseId,
                      purchaser_id: userId,
                      purchaser_username: purchaserProfile?.username || 'Member',
                      package_name: tier.name,
                      purchase_amount: canonicalPrice,
                      purchaser_rank: tier.rank,
                      purchaser_rank_level: purchaserRankLevel,
                      recipient_id: uplineProf.id,
                      recipient_username: uplineProf.username || 'Upline',
                      recipient_rank: uplineProf.current_rank || 'None',
                      recipient_rank_level: uplineRankLevel,
                      upline_position: qualifiedCount + 1,
                      commission_pct: percentages[qualifiedCount],
                      commission_amount: 0.00,
                      status: 'skipped',
                      reason: `Skipped: Current rank (${uplineProf.current_rank || 'None'}) is below purchaser rank (${tier.rank})`,
                      created_at: new Date().toISOString()
                    });
                  } catch (_) {}

                  try {
                    await client.from('activities').insert({
                      user_id: uplineProf.id,
                      type: 'info',
                      title: 'Team Income Skipped',
                      details: `Team Income skipped — your current rank (${uplineProf.current_rank || 'None'}) does not meet the required rank (${tier.rank}) for the purchase by ${purchaserProfile?.username || 'Downline'}. This position was passed up to the next eligible upline.`,
                      amount: 0.00,
                      category: 'team',
                      created_at: new Date().toISOString()
                    });
                  } catch (_) {}
                }
              }

              // Record remaining unallocated
              while (qualifiedCount < 5) {
                qualifiedCount++;
                const pct = percentages[qualifiedCount - 1];
                const comm = parseFloat((canonicalPrice * pct / 100).toFixed(2));
                try {
                  await client.from('team_income_log').insert({
                    purchase_id: purchaseId,
                    purchaser_id: userId,
                    purchaser_username: purchaserProfile?.username || 'Member',
                    package_name: tier.name,
                    purchase_amount: canonicalPrice,
                    purchaser_rank: tier.rank,
                    purchaser_rank_level: purchaserRankLevel,
                    recipient_id: null,
                    recipient_username: 'Unallocated Pool',
                    recipient_rank: 'None',
                    recipient_rank_level: 0,
                    upline_position: qualifiedCount,
                    commission_pct: pct,
                    commission_amount: comm,
                    status: 'unallocated',
                    reason: 'Unallocated: Upline tree ended before 5 qualified uplines were found',
                    created_at: new Date().toISOString()
                  });
                } catch (_) {}
              }
            }
        // ---- System Maintenance (10% of every purchase, all users) ----
        if (purchaseData && purchaseData.length > 0) {
          const purchaseId = purchaseData[0].id;
          try {
            const { data: existingMaint } = await client
              .from('system_maintenance')
              .select('id')
              .eq('purchase_id', purchaseId)
              .limit(1);
            if (!existingMaint || existingMaint.length === 0) {
              const maintenance = parseFloat((canonicalPrice * 0.1).toFixed(2));
              let purchaserUsername = 'Unknown';
              try {
                const { data: prf } = await client
                  .from('profiles')
                  .select('username')
                  .eq('id', userId)
                  .single();
                if (prf) purchaserUsername = prf.username;
              } catch (_) {}
              await client.from('system_maintenance').insert({
                user_id:        userId,
                user_name:      purchaserUsername,
                package_name:   tier.name,
                rank_name:      tier.rank,
                purchase_amount: canonicalPrice,
                maintenance_pct: 10,
                maintenance_amount: maintenance,
                purchase_id:    purchaseId,
                status:         'completed',
                created_at:     new Date().toISOString()
              });
            }
          } catch (maintErr) {
            console.warn('System maintenance log note:', maintErr);
          }
        }
    } catch (purchaseErr) {
      console.warn('Purchase log note:', purchaseErr);
    }




    // 2. Update the user's profile with new package + rank AND DEDUCT BALANCE
    const updatePayload = {
      current_package:   tier.key,
      current_rank:      tier.rank,
      rank:              tier.rank,
      rank_value:        tier.id,
      available_balance: newBalance,
      updated_at:        new Date().toISOString()
    };

    let { error: updateErr } = await client
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (updateErr) {
      console.warn('Full profile update note, retrying with core columns:', updateErr.message);
      const corePayload = {
        current_package:   tier.key,
        current_rank:      tier.rank,
        available_balance: newBalance,
        updated_at:        new Date().toISOString()
      };
      const fallbackRes = await client
        .from('profiles')
        .update(corePayload)
        .eq('id', userId);
      if (fallbackRes.error) {
        throw new Error('Failed to update your package: ' + fallbackRes.error.message);
      }
    }

    // 3. Record activity log
    try {
      await client.from('activities').insert({
        user_id:     userId,
        category:    'package',
        title:       `Upgraded to ${tier.name}`,
        details:     `Package upgrade to ${tier.name} (-$${canonicalPrice.toFixed(2)} USDT)`,
        amount:      -canonicalPrice,
        created_at:  new Date().toISOString()
      });
    } catch (_) { }

    // Update local state
    pkgCurrentIndex = idx;
    pkgCloseConfirm();

    // Re-render package cards
    pkgUpdateCardDisplay();
    pkgRenderPanel();
    
    // Update all live balance and rank elements across the dashboard
    const formattedBal = `$${newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
    const numBal = newBalance.toFixed(2);
    
    const availBalEl = document.getElementById('valAvailableBal');
    if (availBalEl) availBalEl.textContent = formattedBal;

    const mainBalEl = document.getElementById('walletMainBalance');
    if (mainBalEl) mainBalEl.textContent = numBal;

    const usdValEl = document.getElementById('walletUsdValue');
    if (usdValEl) usdValEl.textContent = `≈ $${numBal}`;

    const withBalEl = document.getElementById('withdrawAvailableBal');
    if (withBalEl) withBalEl.textContent = `${numBal} USDT`;

    const withCardBalEl = document.getElementById('withdrawCardAvailableBal');
    if (withCardBalEl) withCardBalEl.textContent = `${numBal} USDT`;

    const rankBadgeEl = document.getElementById('profUserRankBadge');
    if (rankBadgeEl) rankBadgeEl.textContent = '✦ ' + tier.rank.toUpperCase();

    // If upgraded from UNRANKED (tier.id >= 1), unlock referral link section immediately
    if (tier.id >= 1) {
      const refLockedSection = document.getElementById('refLockedSection');
      const refUnlockedSection = document.getElementById('refUnlockedSection');
      if (refLockedSection) refLockedSection.style.display = 'none';
      if (refUnlockedSection) refUnlockedSection.style.display = 'flex';
    }

    // Refresh entire dashboard data silently if available
    if (typeof window.initDashboard === 'function') {
      window.initDashboard();
    }

    // Show congratulations popup
    pkgShowCongrats(tier, canonicalPrice);

  } catch (err) {
    console.error('Package upgrade error:', err);
    pkgShowToast('⚠ ' + (err.message || 'Upgrade failed. Please try again.'), 'error');
  } finally {
    isPurchasing = false;
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
  if (el('pkgCongratsValue'))   el('pkgCongratsValue').textContent  = '$' + parseFloat(price).toFixed(2) + ' USDT';

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
    particles.push(createParticle());
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;

      if (p.alpha <= 0 || p.y < -10) {
        particles.splice(i, 1);
        particles.push(createParticle());
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    window._pkgParticleRaf = requestAnimationFrame(draw);
  }

  draw();
}

// ─── Slide-over Panel: Toggle ─────────────────────────────────────────────────
function pkgTogglePanel() {
  pkgPanelOpen = !pkgPanelOpen;
  const overlay  = document.getElementById('pkgPanelOverlay');
  const panel    = document.getElementById('pkgPanel');
  const openBtn  = document.getElementById('pkgOpenPanelBtn');

  if (pkgPanelOpen) {
    pkgRenderPanel();
    if (overlay)  overlay.classList.add('active');
    if (panel)    panel.classList.add('active');
    if (openBtn)  openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  } else {
    if (overlay)  overlay.classList.remove('active');
    if (panel)    panel.classList.remove('active');
    if (openBtn)  openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
}

// ─── Slide-over Panel: Render all 8 tiers ─────────────────────────────────────
function pkgRenderPanel() {
  const container = document.getElementById('pkgTiersList');
  if (!container) return;

  const total = PKG_TIERS.length;
  const current = pkgCurrentIndex; // -1 .. 7

  // Update progress bar
  const progressPct = current < 0 ? 0 : Math.round(((current + 1) / total) * 100);
  const fillEl = document.getElementById('pkgProgressFill');
  const textEl = document.getElementById('pkgProgressText');
  if (fillEl) fillEl.style.width = progressPct + '%';
  if (textEl) textEl.textContent = `${current < 0 ? 0 : current + 1} of ${total} Packages Achieved`;

  // Render cards
  container.innerHTML = PKG_TIERS.map((tier, idx) => {
    let statusClass = 'tier-locked';
    let badgeHtml   = '<span class="tier-badge badge-locked">🔒 LOCKED</span>';
    let btnHtml     = `<button class="tier-action-btn btn-locked" disabled>Locked</button>`;

    if (idx <= current) {
      statusClass = 'tier-achieved';
      badgeHtml   = '<span class="tier-badge badge-achieved">✓ ACHIEVED</span>';
      btnHtml     = `<button class="tier-action-btn btn-achieved" disabled>Active</button>`;
    } else if (idx === current + 1) {
      statusClass = 'tier-available';
      badgeHtml   = '<span class="tier-badge badge-available">★ NEXT UPGRADE</span>';
      btnHtml     = `<button class="tier-action-btn btn-upgrade" onclick="pkgOpenConfirm(${idx})">Upgrade — $${tier.price}</button>`;
    }

    return `
      <div class="pkg-tier-card ${statusClass}">
        <div class="tier-card-left">
          <div class="tier-icon-box">${tier.icon}</div>
          <div class="tier-info">
            <div class="tier-name">${tier.name}</div>
            <div class="tier-rank">Rank: ${tier.rank}</div>
          </div>
        </div>
        <div class="tier-card-right">
          <div class="tier-price">$${tier.price} <span class="tier-currency">USDT</span></div>
          <div class="tier-status-wrap">
            ${badgeHtml}
            ${btnHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Global export & auto-initialization ──────────────────────────────────────
window.PkgSystem = {
  openConfirm: pkgOpenConfirm,
  closeConfirm: pkgCloseConfirm,
  confirmPurchase: pkgConfirmPurchase,
  togglePanel: pkgTogglePanel,
  closeCongrats: pkgCloseCongrats,
  loadUserState: pkgLoadUserState,
  updateCardDisplay: pkgUpdateCardDisplay
};

// Auto-run when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  pkgLoadUserState();
  setTimeout(pkgLoadUserState, 1000);
});
