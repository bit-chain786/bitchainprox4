/* ==========================================================================
   BITCHAIN PRO X — NON-WORKING INCOME (30% 8-LEVEL POOL SYSTEM) JS
   Live Supabase Realtime Synchronization, 5-Member Progression & Lock Engine
   ========================================================================== */

'use strict';

(function() {
  const NW_TIERS = [
    { level: 1, key: 'starter',   name: 'STARTER',   rank: 'Starter',   price: 5,   contrib: 1.50,  icon: '🌱' },
    { level: 2, key: 'basic',     name: 'BASIC',     rank: 'Basic',     price: 10,  contrib: 3.00,  icon: '⚡' },
    { level: 3, key: 'silver',    name: 'SILVER',    rank: 'Silver',    price: 20,  contrib: 6.00,  icon: '🥈' },
    { level: 4, key: 'gold',      name: 'GOLD',      rank: 'Gold',      price: 40,  contrib: 12.00, icon: '🥇' },
    { level: 5, key: 'diamond',   name: 'DIAMOND',   rank: 'Diamond',   price: 80,  contrib: 24.00, icon: '💎' },
    { level: 6, key: 'elite',     name: 'ELITE',     rank: 'Elite',     price: 160, contrib: 48.00, icon: '👑' },
    { level: 7, key: 'executive', name: 'EXECUTIVE', rank: 'Executive', price: 320, contrib: 96.00, icon: '🏆' },
    { level: 8, key: 'royal',     name: 'ROYAL',     rank: 'Royal',     price: 640, contrib: 192.00,icon: '💠' }
  ];

  let _selectedLevel = 1;
  let _activeUser = null;
  let _userProfile = null;
  let _userMaxLevel = 0; // 0 = unranked, 1..8
  let _allPools = [];
  let _allMembers = [];

  function getClient() {
    return window.BitchainAuth && typeof window.BitchainAuth.getSupabase === 'function'
      ? window.BitchainAuth.getSupabase()
      : null;
  }

  function getRankLevel(rank) {
    if (!rank) return 0;
    const r = rank.toLowerCase().trim();
    const idx = NW_TIERS.findIndex(t => t.key === r || t.name.toLowerCase() === r || t.rank.toLowerCase() === r);
    return idx >= 0 ? idx + 1 : 0;
  }

  // ─── Format USDT Currency ──────────────────────────────────────────────────
  function fmt(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
      return '—';
    }
  }

  // ─── Initialization ────────────────────────────────────────────────────────
  async function initNonWorkingPage() {
    const client = getClient();
    if (!client) return;

    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        window.location.href = 'login.html';
        return;
      }
      _activeUser = session.user;

      // Load user profile
      if (window.BitchainAuth && typeof window.BitchainAuth.getUserProfile === 'function') {
        _userProfile = await window.BitchainAuth.getUserProfile(_activeUser.id);
      }
      if (!_userProfile) {
        const { data } = await client.from('profiles').select('*').eq('id', _activeUser.id).maybeSingle();
        _userProfile = data || {};
      }

      const rawRank = _userProfile.rank || _userProfile.current_rank || _userProfile.current_package || '';
      _userMaxLevel = getRankLevel(rawRank);
      if (_userMaxLevel === 0 && _userProfile.rank_value > 0) {
        _userMaxLevel = Math.min(8, _userProfile.rank_value);
      }

      // Default selected level: user's highest level (or level 1 if unranked)
      _selectedLevel = _userMaxLevel > 0 ? _userMaxLevel : 1;

      // Render static shell components
      renderHeaderStats();
      renderLevelTabs();
      renderMiniLevelsGrid();

      // Load 2 Directs Requirement & Pending Rewards
      await loadDirectsRequirement();

      // Load live pool data
      await loadLevelData(_selectedLevel);

      // Setup Realtime Live Subscriptions
      setupRealtimeSubscriptions();

    } catch (e) {
      console.error('Non-working init error:', e);
    }
  }

  // ─── Render Top Metric Stats ───────────────────────────────────────────────
  function renderHeaderStats() {
    const nonWorkEarned = parseFloat(_userProfile?.non_working_income || 0);
    const earnedEl = document.getElementById('nwStatEarned');
    if (earnedEl) earnedEl.textContent = `$${fmt(nonWorkEarned)} USDT`;

    const userRankName = _userMaxLevel > 0 ? NW_TIERS[_userMaxLevel - 1].name : 'UNRANKED';
    const rankEl = document.getElementById('nwStatRank');
    if (rankEl) rankEl.textContent = userRankName;

    const levelEl = document.getElementById('nwStatLevel');
    if (levelEl) levelEl.textContent = _userMaxLevel > 0 ? `Level ${_userMaxLevel} Achieved` : 'Upgrade to Unlock';
  }

  // ─── Render 8 Level Tabs ───────────────────────────────────────────────────
  function renderLevelTabs() {
    const container = document.getElementById('nwLevelTabs');
    if (!container) return;

    container.innerHTML = NW_TIERS.map(t => {
      const isUnlocked = _userMaxLevel >= t.level;
      const isActive = _selectedLevel === t.level;

      return `
        <div class="nw-level-tab ${isActive ? 'active' : ''} ${isUnlocked ? 'unlocked' : 'locked'}"
             onclick="window.NonWorkingSystem.selectLevel(${t.level})">
          <span class="tab-icon">${t.icon}</span>
          <span>Level ${t.level}: ${t.name}</span>
          <span class="tab-badge ${isUnlocked ? 'unlocked' : 'locked'}">
            ${isUnlocked ? '✓ UNLOCKED' : '🔒 $' + t.price}
          </span>
        </div>
      `;
    }).join('');
  }

  // ─── Render 8-Level Mini Overview Grid ─────────────────────────────────────
  function renderMiniLevelsGrid() {
    const grid = document.getElementById('nwLevelsGrid');
    if (!grid) return;

    grid.innerHTML = NW_TIERS.map(t => {
      const isUnlocked = _userMaxLevel >= t.level;
      const isCurrent = _selectedLevel === t.level;

      return `
        <div class="nw-mini-level-card ${isCurrent ? 'active' : ''}"
             onclick="window.NonWorkingSystem.selectLevel(${t.level})">
          <div class="nw-mini-card-top">
            <span class="nw-mini-card-name">${t.icon} Level ${t.level} (${t.name})</span>
            <span class="nw-mini-card-price">$${t.price} Tier</span>
          </div>
          <div class="nw-mini-card-prize" id="miniPrizeLvl${t.level}">
            $${fmt(t.contrib * 5)} Pool
          </div>
          <div class="nw-mini-card-status">
            ${isUnlocked ? '<span style="color:#00f5d4">● Unlocked</span>' : '<span style="color:rgba(255,255,255,0.4)">🔒 Locked</span>'}
            · 30% = $${t.contrib.toFixed(2)}/user
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Select Level ──────────────────────────────────────────────────────────
  async function selectLevel(lvl) {
    _selectedLevel = lvl;
    renderLevelTabs();
    renderMiniLevelsGrid();
    await loadLevelData(lvl);
    await loadDirectsRequirement();
  }

  // ─── Load Level Data (Pools, Active Block, Achievers, History) ──────────────
  async function loadLevelData(lvl) {
    const client = getClient();
    if (!client) return;

    const tier = NW_TIERS[lvl - 1];
    const isUnlocked = _userMaxLevel >= lvl;

    // Update level display header
    const titleEl = document.getElementById('nwActiveLevelTitle');
    if (titleEl) titleEl.textContent = `LEVEL ${tier.level} — ${tier.name} POOL`;

    const iconEl = document.getElementById('nwActiveLevelIcon');
    if (iconEl) iconEl.textContent = tier.icon;

    const subEl = document.getElementById('nwActiveLevelSub');
    if (subEl) subEl.textContent = `Rank Upgrade Tier: $${tier.price} USDT · 30% Contribution = $${tier.contrib.toFixed(2)} USDT per user`;

    // Handle rank-locked overlay
    const lockOverlay = document.getElementById('nwLockedOverlay');
    if (lockOverlay) {
      if (!isUnlocked) {
        lockOverlay.style.display = 'flex';
        const lockText = document.getElementById('nwLockedRequiredRank');
        if (lockText) lockText.textContent = tier.name;
      } else {
        lockOverlay.style.display = 'none';
      }
    }

    // ── DIRECTS REQUIREMENT GATE ─────────────────────────────────────────────
    // Check if user meets direct referral requirement BEFORE loading pool data
    if (isUnlocked && _activeUser) {
      try {
        const uName = (_userProfile?.username || '').trim().toLowerCase();
        const refCode = (_userProfile?.referral_code || '').trim().toLowerCase();
        const { data: allP } = await client.from('profiles').select('id, sponsor_username').neq('id', _activeUser.id);
        const directCount = (allP || []).filter(p => {
          const sp = (p.sponsor_username || '').trim().toLowerCase();
          return (uName && sp === uName) || (refCode && sp === refCode);
        }).length;

        const requiredDirects = (lvl === 1) ? 1 : 2;

        if (directCount < requiredDirects) {
          // Not qualified — show locked message, hide pool content
          _showDirectsGate(tier, directCount, requiredDirects);
          return; // stop here — don't load pool data
        } else {
          _hideDirectsGate(); // qualified — show pool content normally
        }
      } catch (_) {
        _hideDirectsGate(); // on error, show data anyway
      }
    } else {
      _hideDirectsGate();
    }
    // ────────────────────────────────────────────────────────────────────────

    try {
      // 1. Fetch all members in this level ordered by sequence_num
      let { data: members } = await client
        .from('non_working_members')
        .select('*')
        .eq('level', lvl)
        .order('sequence_num', { ascending: true });

      let levelMembers = members || [];

      // Auto self-heal / sync if current user has achieved this level but is missing from members table
      const hasMe = levelMembers.some(m => m.user_id === _activeUser.id || (m.username && _userProfile?.username && m.username.toLowerCase() === _userProfile.username.toLowerCase()));
      if (!hasMe && isUnlocked) {
        try {
          await client.rpc('sync_existing_purchases_to_non_working');
          const { data: refetched } = await client
            .from('non_working_members')
            .select('*')
            .eq('level', lvl)
            .order('sequence_num', { ascending: true });
          if (refetched && refetched.length > 0) {
            levelMembers = refetched;
          }
        } catch (_) {}
      }

      // 2. Fetch all pools for this level
      const { data: pools } = await client
        .from('non_working_pools')
        .select('*')
        .eq('level', lvl)
        .order('pool_num', { ascending: true });

      const levelPools = pools || [];

      // Determine active pool number: ((totalMembersCount) / 5) + 1
      const activePoolNum = Math.floor(levelMembers.length / 5) + 1;
      const activePoolRecord = levelPools.find(p => p.pool_num === activePoolNum) || null;

      // Members in active pool block: sequence ((activePoolNum-1)*5 + 1) to (activePoolNum*5)
      const startSeq = (activePoolNum - 1) * 5 + 1;
      const endSeq = activePoolNum * 5;
      const activeBlockMembers = levelMembers.filter(m => m.sequence_num >= startSeq && m.sequence_num <= endSeq);

      // Check if current user has a claimable reward for this level
      const { data: levelClaimables } = await client
        .from('non_working_distributions')
        .select('*')
        .eq('recipient_user_id', _activeUser.id)
        .eq('level', lvl)
        .eq('status', 'claimable');

      const userClaimableForLevel = (levelClaimables && levelClaimables.length > 0) ? levelClaimables[0] : null;

      // Render Active Pool Card (including claim banner if eligible)
      renderActivePoolCard(tier, activePoolNum, activePoolRecord, activeBlockMembers, startSeq, endSeq, levelMembers, levelPools, userClaimableForLevel);

      // Render Sequence List in Drawer
      _currentLevelMembers = levelMembers;
      const countEl = document.getElementById('nwAllMembersCount');
      if (countEl) countEl.textContent = levelMembers.length;

      const headingEl = document.getElementById('nwAllMembersHeading');
      if (headingEl) headingEl.textContent = `📜 Chronological Sequence in Level ${lvl} (${tier.name})`;

      renderSequenceList(levelMembers, tier);

      // Render Achievers Table
      renderAchieversTable(levelMembers, tier);

      // Render Completed Pools Table
      const completedPools = levelPools.filter(p => p.status === 'completed');
      renderCompletedPoolsTable(completedPools, tier);

    } catch (err) {
      console.warn('Error loading level data:', err);
    }
  }

  // ─── Directs Gate: Show locked message over pool content ───────────────────
  function _showDirectsGate(tier, currentCount, required) {
    const refParam = _userProfile?.referral_code || _userProfile?.username || _activeUser?.id?.substring(0, 8) || '';
    let origin = window.location.origin;
    if (!origin || origin === 'null' || origin.startsWith('file')) origin = 'https://bitchainprox.com';
    const refLink = `${origin}/register.html?ref=${refParam}`;

    // Create or update the gate overlay
    let gate = document.getElementById('nwDirectsGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'nwDirectsGate';
      gate.className = 'nw-directs-gate';
      // Insert it before the pool card section
      const poolCard = document.querySelector('.nw-active-pool-card, #nwActivePoolSection, .nw-pool-card-wrapper');
      if (poolCard) poolCard.parentNode.insertBefore(gate, poolCard);
      else document.querySelector('.nw-level-content')?.appendChild(gate);
    }

    gate.style.display = 'flex';
    gate.innerHTML = `
      <div class="nw-gate-inner">
        <div class="nw-gate-icon">🔒</div>
        <div class="nw-gate-title">Direct Referral Requirement Not Met</div>
        <div class="nw-gate-desc">
          You need <strong>${required} direct referral${required > 1 ? 's' : ''}</strong> to view and receive rewards from the
          <strong>${tier.name} Pool (Level ${tier.level})</strong>.
        </div>
        <div class="nw-gate-progress">
          <div class="nw-gate-prog-bar">
            <div class="nw-gate-prog-fill" style="width:${Math.min(100, (currentCount / required) * 100)}%"></div>
          </div>
          <div class="nw-gate-prog-text">${currentCount} / ${required} Direct${required > 1 ? 's' : ''} Invited</div>
        </div>
        <div class="nw-gate-steps">
          <div class="nw-gate-step ${currentCount >= 1 ? 'done' : ''}">
            ${currentCount >= 1 ? '✅' : '⏳'} Invite Direct #1
          </div>
          ${required >= 2 ? `<div class="nw-gate-step ${currentCount >= 2 ? 'done' : ''}">
            ${currentCount >= 2 ? '✅' : '⏳'} Invite Direct #2
          </div>` : ''}
        </div>
        <div class="nw-gate-ref-box">
          <div class="nw-gate-ref-label">🔗 Your Referral Link</div>
          <div class="nw-gate-ref-row">
            <input class="nw-gate-ref-input" type="text" readonly value="${refLink}" onclick="this.select()" />
            <button class="nw-gate-copy-btn" onclick="navigator.clipboard.writeText('${refLink}').then(()=>{this.textContent='✅ Copied!';setTimeout(()=>{this.textContent='Copy'},2000)})">Copy</button>
          </div>
        </div>
        <div class="nw-gate-note">
          Once you invite ${required - currentCount} more direct user${(required - currentCount) > 1 ? 's' : ''}, this pool's data and rewards will automatically unlock.
        </div>
      </div>
    `;

    // Hide pool content sections
    _togglePoolSections(false);
  }

  function _hideDirectsGate() {
    const gate = document.getElementById('nwDirectsGate');
    if (gate) gate.style.display = 'none';
    _togglePoolSections(true);
  }

  function _togglePoolSections(visible) {
    const display = visible ? '' : 'none';
    const selectors = [
      '.nw-active-pool-card', '.nw-pool-card-wrapper', '#nwActivePoolSection',
      '.nw-winner-banner', '#btnToggleAllMembers', '.nw-achievers-section',
      '.nw-completed-pools-section', '.nw-history-section'
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.display = display; });
    });
  }

  // ─── Render Active Pool Card ───────────────────────────────────────────────
  function renderActivePoolCard(tier, poolNum, poolRecord, blockMembers, startSeq, endSeq, allLevelMembers, allPools = [], userClaimable = null) {
    const count = blockMembers.length;
    const isCompleted = count >= 5;

    // Status Badge
    const badgeEl = document.getElementById('nwActivePoolBadge');
    if (badgeEl) {
      badgeEl.className = `nw-pool-status-badge ${isCompleted ? 'completed' : 'active'}`;
      badgeEl.textContent = isCompleted ? `✓ POOL #${poolNum} COMPLETED` : `POOL #${poolNum} — IN PROGRESS (${count}/5)`;
    }

    // Accumulated Prize Amount
    // If current pool has members, show current accumulation.
    // If current pool has 0 members BUT previous pool completed, show previous completed pool amount ($15.00)
    let currentPoolAmount = 0;
    const completedPools = allPools.filter(p => p.status === 'completed');
    const lastCompleted = completedPools.length > 0 ? completedPools[completedPools.length - 1] : null;

    if (poolRecord && typeof poolRecord.total_pool_amount === 'number' && poolRecord.total_pool_amount > 0) {
      currentPoolAmount = poolRecord.total_pool_amount;
    } else if (count > 0) {
      currentPoolAmount = blockMembers.reduce((acc, m) => acc + (parseFloat(m.contribution_amount) || 0), 0);
    } else if (lastCompleted && typeof lastCompleted.total_pool_amount === 'number') {
      currentPoolAmount = lastCompleted.total_pool_amount;
    }

    const maxPrize = tier.contrib * 5;

    const prizeEl = document.getElementById('nwPrizeAmount');
    if (prizeEl) prizeEl.textContent = `$${fmt(currentPoolAmount)} USDT`;

    const formulaEl = document.getElementById('nwPrizeFormula');
    if (formulaEl) {
      if (count === 0 && lastCompleted) {
        formulaEl.textContent = `Pool #${lastCompleted.pool_num} Completed ($${fmt(lastCompleted.total_pool_amount)} USDT) · Next Pool #${poolNum} Starting (0/5)`;
      } else if (count === 0) {
        formulaEl.textContent = `New pool starting — 5 users × $${tier.contrib.toFixed(2)} (30% of $${tier.price}) = $${maxPrize.toFixed(2)} target prize`;
      } else {
        formulaEl.textContent = `${count} Users × $${tier.contrib.toFixed(2)} (30% of $${tier.price}) = $${fmt(currentPoolAmount)} USDT accumulated`;
      }
    }

    // Progress Bar
    const pct = Math.min(100, Math.round((count / 5) * 100));
    const fillEl = document.getElementById('nwProgressFill');
    if (fillEl) fillEl.style.width = `${pct}%`;

    const progText = document.getElementById('nwProgressText');
    if (progText) progText.textContent = `${count} of 5 Members Joined (${pct}%)`;

    // Designated Winner (User #poolNum in this level)
    const winnerUser = allLevelMembers.find(m => m.sequence_num === poolNum) || null;
    const winnerNameEl = document.getElementById('nwWinnerName');
    if (winnerNameEl) {
      if (winnerUser) {
        winnerNameEl.textContent = `User #${poolNum}: ${winnerUser.full_name || winnerUser.username} (@${winnerUser.username})`;
      } else {
        winnerNameEl.textContent = `User #${poolNum} (Awaiting Member #${poolNum})`;
      }
    }

    // User's own position in this level
    const myEntry = allLevelMembers.find(m => m.user_id === _activeUser.id || (m.username && _userProfile?.username && m.username.toLowerCase() === _userProfile.username.toLowerCase()));
    const posTag = document.getElementById('nwUserPositionTag');
    if (posTag) {
      if (myEntry) {
        posTag.innerHTML = `👤 Your Sequence: <strong>#${myEntry.sequence_num}</strong> (in Pool #${myEntry.pool_num || poolNum}) · You win Pool #${myEntry.sequence_num} Prize!`;
      } else if (_userMaxLevel >= tier.level) {
        posTag.innerHTML = `👤 Level ${tier.level} Achieved · Your slot will appear upon pool entry!`;
      } else {
        posTag.innerHTML = `👤 Not in Sequence yet · Upgrade to join as <strong>#${allLevelMembers.length + 1}</strong>`;
      }
    }

    // ── Render Claim Banner directly inside Active Pool Showcase Card ─────────
    const claimBannerEl = document.getElementById('nwClaimBanner');
    if (claimBannerEl) {
      if (userClaimable) {
        claimBannerEl.style.display = 'block';
        claimBannerEl.innerHTML = `
          <div class="nw-claim-hero-card">
            <div class="nw-claim-hero-info">
              <span class="nw-claim-hero-badge">🎉 POOL #${userClaimable.pool_num} COMPLETED — REWARD READY</span>
              <span class="nw-claim-hero-title">You Won <strong>$${fmt(userClaimable.amount)} USDT</strong> Prize!</span>
              <span class="nw-claim-hero-sub">Click below to claim your Non-Working prize directly to your available wallet balance.</span>
            </div>
            <button class="btn-claim-reward-hero" onclick="window.NonWorkingSystem.claimReward('${userClaimable.id}', this)">
              ⚡ CLAIM $${fmt(userClaimable.amount)} USDT NOW
            </button>
          </div>
        `;
      } else {
        claimBannerEl.style.display = 'none';
      }
    }

    // 5-Slot Cards
    const slotsRow = document.getElementById('nwSlotsRow');
    if (slotsRow) {
      let slotsHtml = '';
      for (let i = 0; i < 5; i++) {
        const targetSeq = startSeq + i;
        const member = blockMembers[i] || null;
        const isWinner = (targetSeq === poolNum);
        const isMe = member && (member.user_id === _activeUser.id || (member.username && _userProfile?.username && member.username.toLowerCase() === _userProfile.username.toLowerCase()));

        if (member) {
          slotsHtml += `
            <div class="nw-slot-card filled ${isMe ? 'is-me' : ''} ${isWinner ? 'winner' : ''}">
              ${isMe ? '<span class="nw-slot-badge-you">⭐ You</span>' : (isWinner ? '<span class="nw-slot-badge-winner">🏆 Winner</span>' : '')}
              <div class="nw-slot-avatar">${(member.full_name || member.username || 'U').charAt(0).toUpperCase()}</div>
              <div class="nw-slot-seq">Sequence #${member.sequence_num}</div>
              <div class="nw-slot-user" title="${member.full_name || member.username}">
                ${member.username || 'Member'} ${isMe ? '<span style="color:#00f5d4;font-size:0.7rem;">(You)</span>' : ''}
              </div>
              <div class="nw-slot-contrib">+$${fmt(member.contribution_amount || tier.contrib)}</div>
            </div>
          `;
        } else {
          slotsHtml += `
            <div class="nw-slot-card">
              <div class="nw-slot-avatar" style="opacity:0.4;">⏳</div>
              <div class="nw-slot-seq" style="color:rgba(255,255,255,0.4);">Slot #${targetSeq}</div>
              <div class="nw-slot-empty-text">Waiting for user #${targetSeq}…</div>
              <div class="nw-slot-contrib" style="opacity:0.5;">30% = $${tier.contrib.toFixed(2)}</div>
            </div>
          `;
        }
      }
      slotsRow.innerHTML = slotsHtml;
    }
  }

  // ─── Render All Members Sequence Drawer List ──────────────────────────────
  let _currentLevelMembers = [];

  function renderSequenceList(members, tier) {
    const listEl = document.getElementById('nwSeqList');
    if (!listEl) return;

    const t = tier || NW_TIERS[_selectedLevel - 1];
    const query = (document.getElementById('nwSeqSearch')?.value || '').toLowerCase().trim();

    let filtered = members || [];
    if (query) {
      filtered = filtered.filter(m => {
        const u = (m.username || '').toLowerCase();
        const fn = (m.full_name || '').toLowerCase();
        const seq = String(m.sequence_num);
        return u.includes(query) || fn.includes(query) || seq.includes(query) || ('#' + seq).includes(query);
      });
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="nw-empty-state" style="padding:20px;text-align:center;">No sequence members matching "${query}" in this level yet.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(m => {
      const isMe = (m.user_id === _activeUser.id || (m.username && _userProfile?.username && m.username.toLowerCase() === _userProfile.username.toLowerCase()));
      const wasMoved = m.was_moved === true;

      return `
        <div class="nw-seq-item ${isMe ? 'is-me' : ''} ${wasMoved ? 'was-moved' : ''}">
          <div class="nw-seq-item-left">
            <div class="nw-seq-num-badge">#${m.sequence_num}</div>
            <div class="nw-seq-user-info">
              <div class="nw-seq-user-name">
                <span>${m.full_name || m.username}</span>
                <span style="color:rgba(224,170,255,0.6);font-weight:400;font-size:0.75rem;">(@${m.username})</span>
                ${isMe ? '<span class="nw-slot-badge-you" style="position:static;display:inline-block;margin-left:6px;font-size:0.6rem;padding:2px 6px;">⭐ YOU</span>' : ''}
                ${wasMoved ? '<span class="nw-moved-badge">⟳ Moved to End</span>' : ''}
              </div>
              <div class="nw-seq-user-details">
                ${m.rank_name || t.name} · Joined: ${fmtDate(m.created_at)}
                ${wasMoved ? '<span style="color:#f59e0b;font-size:0.7rem;margin-left:6px;">⚠ Missing directs — invite more to qualify</span>' : ''}
              </div>
            </div>
          </div>
          <div class="nw-seq-item-right">
            <div class="nw-seq-contrib-val">+$${fmt(m.contribution_amount || t.contrib)} USDT</div>
            <div class="nw-seq-pool-tag">Assigned to Pool #${m.pool_num}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Toggle All Members Drawer ────────────────────────────────────────────
  function toggleAllMembers() {
    const drawer = document.getElementById('nwAllMembersDrawer');
    const btn = document.getElementById('btnToggleAllMembers');
    if (!drawer || !btn) return;

    const isOpen = drawer.style.display !== 'none';
    drawer.style.display = isOpen ? 'none' : 'block';
    btn.classList.toggle('open', !isOpen);
  }

  function filterSequenceList() {
    renderSequenceList(_currentLevelMembers, NW_TIERS[_selectedLevel - 1]);
  }

  // ─── Render Achievers Table ────────────────────────────────────────────────
  function renderAchieversTable(members, tier) {
    const tbody = document.getElementById('nwAchieversTbody');
    if (!tbody) return;

    if (!members || members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="nw-empty-state">No achievers in Level ${tier.level} yet. Be the first to join as #1!</td></tr>`;
      return;
    }

    tbody.innerHTML = [...members].reverse().slice(0, 20).map(m => {
      const isMe = m.user_id === _activeUser?.id;
      return `
        <tr style="${isMe ? 'background:rgba(0,245,212,0.06);font-weight:700;' : ''}">
          <td><span class="nw-seq-badge">#${m.sequence_num}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:0.9rem;">${isMe ? '⭐' : '👤'}</span>
              <span>${m.full_name || m.username} ${isMe ? '<span style="color:#00f5d4;font-size:0.68rem;">(You)</span>' : ''}</span>
            </div>
          </td>
          <td><span style="color:#c77dff;font-weight:700;">$${fmt(m.package_price || tier.price)}</span></td>
          <td><span style="color:#00f5d4;font-weight:800;">+$${fmt(m.contribution_amount || tier.contrib)}</span></td>
          <td style="color:rgba(255,255,255,0.5);font-size:0.75rem;">${fmtDate(m.created_at)}</td>
        </tr>
      `;
    }).join('');
  }

  // ─── Render Completed Pools Table ──────────────────────────────────────────
  function renderCompletedPoolsTable(pools, tier) {
    const tbody = document.getElementById('nwCompletedPoolsTbody');
    if (!tbody) return;

    if (!pools || pools.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="nw-empty-state">No completed pools in Level ${tier.level} yet. Pools complete automatically when 5 users join!</td></tr>`;
      return;
    }

    tbody.innerHTML = pools.map(p => `
      <tr>
        <td><span class="nw-seq-badge" style="background:rgba(0,200,83,0.15);color:#00ff88;">Pool #${p.pool_num}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span>🏆</span>
            <span style="font-weight:700;">User #${p.target_recipient_seq} (@${p.recipient_username || 'winner'})</span>
          </div>
        </td>
        <td><span style="color:#00f5d4;font-weight:900;">$${fmt(p.total_pool_amount || tier.contrib * 5)} USDT</span></td>
        <td style="color:rgba(255,255,255,0.5);font-size:0.75rem;">${fmtDate(p.completed_at || p.updated_at)}</td>
      </tr>
    `).join('');
  }

  // ─── 2 Direct Referrals Requirement Engine ───────────────────────────────
  async function loadDirectsRequirement() {
    const client = getClient();
    if (!client || !_activeUser) return;

    try {
      const uName = (_userProfile?.username || '').trim().toLowerCase();
      const refCode = (_userProfile?.referral_code || '').trim().toLowerCase();

      // Query Direct Referrals
      const { data: allDirects } = await client
        .from('profiles')
        .select('id, username, full_name, current_rank, created_at, sponsor_username')
        .neq('id', _activeUser.id);

      const directs = (allDirects || []).filter(p => {
        const sp = (p.sponsor_username || '').trim().toLowerCase();
        return (uName && sp === uName) || (refCode && sp === refCode);
      });

      const count = directs.length;
      // Requirement: Starter Level 1 requires 1 direct, Higher ranks require 2 directs
      const isStarter = (_selectedLevel === 1);
      const requiredDirects = isStarter ? 1 : 2;
      const isQualified = count >= requiredDirects;
      const tier = NW_TIERS[_selectedLevel - 1] || NW_TIERS[0];

      // Update Card Heading & Subtext
      const heading = document.getElementById('nwReqHeading');
      if (heading) {
        heading.textContent = isStarter
          ? 'Reward Claim Requirement: 1 Direct Referral'
          : 'Reward Claim Requirement: 2 Direct Referrals';
      }

      const subtext = document.getElementById('nwReqSubtext');
      if (subtext) {
        subtext.textContent = isStarter
          ? 'Starter rank ($5 Tier) requires only 1 active direct referral to unlock and claim Non-Working prize earnings.'
          : `${tier.name} rank ($${tier.price} Tier) requires 2 active direct referrals to unlock and claim Non-Working prize earnings.`;
      }

      // Status Pill
      const pill = document.getElementById('nwReqStatusPill');
      const icon = document.getElementById('nwReqStatusIcon');
      const text = document.getElementById('nwReqStatusText');
      if (pill && icon && text) {
        pill.className = `nw-req-status-pill ${isQualified ? 'qualified' : 'pending'}`;
        icon.textContent = isQualified ? '✅' : '⏳';
        text.textContent = isQualified
          ? `${count} / ${requiredDirects} Direct${requiredDirects > 1 ? 's' : ''} (Qualified & Ready)`
          : `${count} / ${requiredDirects} Direct${requiredDirects > 1 ? 's' : ''} Active`;
      }

      // Slot 1 (Required for Starter and Higher)
      const slot1 = document.getElementById('nwReqSlot1');
      const status1 = document.getElementById('nwReqStatus1');
      const badge1 = document.getElementById('nwReqBadge1');
      if (slot1) {
        slot1.style.display = 'flex';
        const label1 = slot1.querySelector('.nw-req-slot-label');
        if (label1) {
          label1.innerHTML = isStarter
            ? 'Direct Referral #1 <span style="color:#00f5d4;font-size:0.7rem;">(Starter Requirement)</span>'
            : 'Direct Referral #1';
        }
      }
      if (directs[0]) {
        if (slot1) slot1.className = 'nw-req-slot active';
        if (status1) status1.textContent = `${directs[0].full_name || directs[0].username} (@${directs[0].username})`;
        if (badge1) { badge1.textContent = '✅'; badge1.style.opacity = '1'; }
      } else {
        if (slot1) slot1.className = 'nw-req-slot';
        if (status1) status1.textContent = 'Waiting for direct signup…';
        if (badge1) { badge1.textContent = '⏳'; badge1.style.opacity = '0.5'; }
      }

      // Slot 2: Hide on Starter (Level 1), Show on Basic & Higher (Level 2..8)
      const slot2 = document.getElementById('nwReqSlot2');
      const status2 = document.getElementById('nwReqStatus2');
      const badge2 = document.getElementById('nwReqBadge2');
      const slotsGrid = document.getElementById('nwReqSlotsGrid');

      if (isStarter) {
        if (slot2) slot2.style.display = 'none';
        if (slotsGrid) slotsGrid.style.gridTemplateColumns = '1fr';
      } else {
        if (slot2) slot2.style.display = 'flex';
        if (slotsGrid) slotsGrid.style.gridTemplateColumns = '';
        if (directs[1]) {
          if (slot2) slot2.className = 'nw-req-slot active';
          if (status2) status2.textContent = `${directs[1].full_name || directs[1].username} (@${directs[1].username})`;
          if (badge2) { badge2.textContent = '✅'; badge2.style.opacity = '1'; }
        } else {
          if (slot2) slot2.className = 'nw-req-slot';
          if (status2) status2.textContent = 'Waiting for direct signup…';
          if (badge2) { badge2.textContent = '⏳'; badge2.style.opacity = '0.5'; }
        }
      }

      // Referral Link Input — Gate behind STARTER rank (level 1 or higher)
      const refInput = document.getElementById('nwRefLinkInput');
      if (refInput) {
        const isUserRankUnlocked = _userMaxLevel >= 1;
        let origin = window.location.origin;
        if (!origin || origin === 'null' || origin.startsWith('file')) {
          origin = 'https://bitchainprox.com';
        }
        if (isUserRankUnlocked) {
          const refParam = _userProfile?.referral_code || _userProfile?.username || _activeUser.id.substring(0, 8);
          refInput.value = `${origin}/register.html?ref=${refParam}`;
        } else {
          refInput.value = '🔒 Upgrade to STARTER rank ($5 Tier) to unlock your referral link';
        }
      }

      // Check for Claimable Distributions (pool completed, waiting for user to claim)
      const { data: claimableDists } = await client
        .from('non_working_distributions')
        .select('*')
        .eq('recipient_user_id', _activeUser.id)
        .eq('status', 'claimable')
        .order('distributed_at', { ascending: true });

      const claimWrap = document.getElementById('nwPendingClaimAction');
      if (claimWrap) {
        if (claimableDists && claimableDists.length > 0) {
          claimWrap.style.display = 'block';

          const buttons = claimableDists.map(dist => {
            const needed = (dist.level === 1) ? 1 : 2;
            const hasEnough = count >= needed;
            const tierName = ['','Starter','Basic','Silver','Gold','Diamond','Elite','Executive','Royal'][dist.level] || `Level ${dist.level}`;

            if (hasEnough) {
              return `
                <div class="nw-claim-card qualified">
                  <div class="nw-claim-card-info">
                    <span class="nw-claim-badge">🏆 Pool #${dist.pool_num} Prize Ready</span>
                    <span class="nw-claim-level">${tierName} · Level ${dist.level}</span>
                  </div>
                  <div class="nw-claim-amount">$${fmt(dist.amount)} USDT</div>
                  <button class="btn-claim-reward" onclick="window.NonWorkingSystem.claimReward('${dist.id}', this)">
                    ⚡ Claim $${fmt(dist.amount)} USDT
                  </button>
                </div>
              `;
            } else {
              return `
                <div class="nw-claim-card locked">
                  <div class="nw-claim-card-info">
                    <span class="nw-claim-badge">🔒 Pool #${dist.pool_num} Prize Locked</span>
                    <span class="nw-claim-level">${tierName} · Level ${dist.level}</span>
                  </div>
                  <div class="nw-claim-amount">$${fmt(dist.amount)} USDT</div>
                  <div class="nw-claim-locked-msg">
                    ⏳ Need ${needed} direct${needed > 1 ? 's' : ''} · You have ${count}/${needed}
                  </div>
                </div>
              `;
            }
          }).join('');

          claimWrap.innerHTML = `
            <div class="nw-claims-section">
              <div class="nw-claims-heading">🎉 Your Pool Prizes</div>
              ${buttons}
            </div>
          `;
        } else {
          claimWrap.style.display = 'none';
        }
      }

    } catch (e) {
      console.warn('Error loading directs requirement:', e);
    }
  }

  // ─── Copy Referral Link ───────────────────────────────────────────────────
  function copyReferralLink() {
    const input = document.getElementById('nwRefLinkInput');
    if (!input || !input.value) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(() => {
        showCopyToast('Referral Link Copied to Clipboard!');
      });
    } else {
      input.select();
      document.execCommand('copy');
      showCopyToast('Referral Link Copied to Clipboard!');
    }
  }

  function showCopyToast(msg) {
    const btn = document.querySelector('.btn-copy-ref');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.style.background = '#00f5d4';
      btn.style.color = '#000';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.style.color = '';
      }, 2500);
    }
  }

  // ─── Claim Non-Working Reward ─────────────────────────────────────────────
  async function claimReward(distributionId, btnEl) {
    const client = getClient();
    if (!client || !distributionId) return;

    const btn = btnEl || document.querySelector('.btn-claim-reward');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Claiming…'; }

    try {
      const { data, error } = await client.rpc('claim_non_working_reward', { p_distribution_id: distributionId });

      if (error) {
        if (btn) { btn.disabled = false; btn.textContent = '⚡ Claim USDT'; }
        alert(error.message || 'Failed to claim reward');
        return;
      }

      if (data && data.success) {
        alert(`🎉 $${parseFloat(data.amount).toFixed(2)} USDT claimed and added to your wallet!`);
        if (btn) {
          btn.textContent = '✅ Claimed!';
          btn.style.background = '#00f5d4';
          btn.style.color = '#000';
        }
        if (window.BitchainAuth && typeof window.BitchainAuth.getUserProfile === 'function') {
          _userProfile = await window.BitchainAuth.getUserProfile(_activeUser.id);
          if (_userProfile) {
            localStorage.setItem('bitchain_user_profile', JSON.stringify(_userProfile));
          }
        }
        renderHeaderStats();
        await loadDirectsRequirement();
        await loadLevelData(_selectedLevel);
      } else {
        alert(data?.error || 'Could not claim reward');
        if (btn) { btn.disabled = false; btn.textContent = '⚡ Claim Reward'; }
      }
    } catch (err) {
      console.error('Claim exception:', err);
      alert('Network error while claiming reward.');
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Claim Reward'; }
    }
  }

  // ─── Realtime Subscriptions ────────────────────────────────────────────────
  function setupRealtimeSubscriptions() {
    const client = getClient();
    if (!client) return;

    client.channel('non-working-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'non_working_members' }, () => {
        loadLevelData(_selectedLevel);
        renderHeaderStats();
        loadDirectsRequirement();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'non_working_pools' }, () => {
        loadLevelData(_selectedLevel);
        renderHeaderStats();
        loadDirectsRequirement();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'non_working_distributions' }, () => {
        loadDirectsRequirement();
      })
      .subscribe();
  }

  // Global exports
  window.NonWorkingSystem = {
    init: initNonWorkingPage,
    selectLevel: selectLevel,
    copyReferralLink: copyReferralLink,
    claimReward: claimReward,
    toggleAllMembers: toggleAllMembers,
    filterSequenceList: filterSequenceList
  };

  document.addEventListener('DOMContentLoaded', () => {
    initNonWorkingPage();
  });

})();
