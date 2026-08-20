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

    // Handle locked overlay
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

    try {
      // 1. Fetch all members in this level ordered by sequence_num
      const { data: members } = await client
        .from('non_working_members')
        .select('*')
        .eq('level', lvl)
        .order('sequence_num', { ascending: true });

      const levelMembers = members || [];
      const totalMembersCount = levelMembers.length;

      // 2. Fetch all pools for this level
      const { data: pools } = await client
        .from('non_working_pools')
        .select('*')
        .eq('level', lvl)
        .order('pool_num', { ascending: true });

      const levelPools = pools || [];

      // Determine active pool number: ((totalMembersCount) / 5) + 1
      const activePoolNum = Math.floor(totalMembersCount / 5) + 1;
      const activePoolRecord = levelPools.find(p => p.pool_num === activePoolNum) || null;

      // Members in active pool block: sequence ((activePoolNum-1)*5 + 1) to (activePoolNum*5)
      const startSeq = (activePoolNum - 1) * 5 + 1;
      const endSeq = activePoolNum * 5;
      const activeBlockMembers = levelMembers.filter(m => m.sequence_num >= startSeq && m.sequence_num <= endSeq);

      // Render Active Pool Card
      renderActivePoolCard(tier, activePoolNum, activePoolRecord, activeBlockMembers, startSeq, endSeq, levelMembers);

      // Render Achievers Table
      renderAchieversTable(levelMembers, tier);

      // Render Completed Pools Table
      const completedPools = levelPools.filter(p => p.status === 'completed');
      renderCompletedPoolsTable(completedPools, tier);

    } catch (err) {
      console.warn('Error loading level data:', err);
    }
  }

  // ─── Render Active Pool Card ───────────────────────────────────────────────
  function renderActivePoolCard(tier, poolNum, poolRecord, blockMembers, startSeq, endSeq, allLevelMembers) {
    const count = blockMembers.length;
    const isCompleted = count >= 5;

    // Status Badge
    const badgeEl = document.getElementById('nwActivePoolBadge');
    if (badgeEl) {
      badgeEl.className = `nw-pool-status-badge ${isCompleted ? 'completed' : 'active'}`;
      badgeEl.textContent = isCompleted ? `✓ POOL #${poolNum} COMPLETED` : `POOL #${poolNum} — IN PROGRESS (${count}/5)`;
    }

    // Accumulated Prize Amount: Sum of actual 30% contributions in this block (or expected $tier.contrib * 5)
    let currentPoolAmount = blockMembers.reduce((acc, m) => acc + (parseFloat(m.contribution_amount) || tier.contrib), 0);
    if (currentPoolAmount === 0) currentPoolAmount = tier.contrib * 5;

    const prizeEl = document.getElementById('nwPrizeAmount');
    if (prizeEl) prizeEl.textContent = `$${fmt(currentPoolAmount)} USDT`;

    const formulaEl = document.getElementById('nwPrizeFormula');
    if (formulaEl) {
      formulaEl.textContent = `5 Users × $${tier.contrib.toFixed(2)} (30% of $${tier.price}) = $${(tier.contrib * 5).toFixed(2)} Total Prize Pool`;
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
    const myEntry = allLevelMembers.find(m => m.user_id === _activeUser.id);
    const posTag = document.getElementById('nwUserPositionTag');
    if (posTag) {
      if (myEntry) {
        posTag.innerHTML = `👤 Your Sequence: <strong>#${myEntry.sequence_num}</strong> · You win Pool #${myEntry.sequence_num}!`;
      } else {
        posTag.innerHTML = `👤 Not in Sequence yet · Upgrade to join as <strong>#${allLevelMembers.length + 1}</strong>`;
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

        if (member) {
          slotsHtml += `
            <div class="nw-slot-card filled ${isWinner ? 'winner' : ''}">
              ${isWinner ? '<span class="nw-slot-badge-winner">🏆 Winner</span>' : ''}
              <div class="nw-slot-avatar">${(member.full_name || member.username || 'U').charAt(0).toUpperCase()}</div>
              <div class="nw-slot-seq">Sequence #${member.sequence_num}</div>
              <div class="nw-slot-user" title="${member.full_name || member.username}">${member.username || 'Member'}</div>
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

  // ─── Realtime Subscriptions ────────────────────────────────────────────────
  function setupRealtimeSubscriptions() {
    const client = getClient();
    if (!client) return;

    client.channel('non-working-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'non_working_members' }, () => {
        loadLevelData(_selectedLevel);
        renderHeaderStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'non_working_pools' }, () => {
        loadLevelData(_selectedLevel);
        renderHeaderStats();
      })
      .subscribe();
  }

  // Global exports
  window.NonWorkingSystem = {
    init: initNonWorkingPage,
    selectLevel: selectLevel
  };

  document.addEventListener('DOMContentLoaded', () => {
    initNonWorkingPage();
  });

})();
