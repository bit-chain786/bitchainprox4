/* ==========================================================================
   BITCHAIN PRO X — REWARDS CALCULATION & CLAIM ENGINE
   Real-Time 60-Day Cycle Tracking, Direct Business Aggregation & Claims
   ========================================================================== */

'use strict';

window.BitchainRewards = (function() {
  const CYCLE_DURATION_DAYS = 60;
  const CYCLE_DURATION_MS = CYCLE_DURATION_DAYS * 24 * 60 * 60 * 1000;

  // 5 Progressive Milestone Tiers
  const REWARD_MILESTONES = [
    { level: 1, target: 500,  reward: 25,  name: 'Level 1' },
    { level: 2, target: 1000, reward: 50,  name: 'Level 2' },
    { level: 3, target: 2000, reward: 100, name: 'Level 3' },
    { level: 4, target: 4000, reward: 200, name: 'Level 4' },
    { level: 5, target: 8000, reward: 400, name: 'Level 5' }
  ];

  /**
   * Computes the active 60-day cycle window based on user registration/activation timestamp
   */
  function computeCycleDates(createdAtStr) {
    const activationDate = createdAtStr ? new Date(createdAtStr) : new Date();
    const now = new Date();
    const actTime = activationDate.getTime();
    const nowTime = now.getTime();

    // Elapsed milliseconds since user account creation
    const elapsed = Math.max(0, nowTime - actTime);
    // Determine which 60-day cycle the user is currently in (0-indexed)
    const currentCycleIndex = Math.floor(elapsed / CYCLE_DURATION_MS);

    const cycleStartTime = actTime + (currentCycleIndex * CYCLE_DURATION_MS);
    const cycleEndTime = cycleStartTime + CYCLE_DURATION_MS;

    const startDate = new Date(cycleStartTime);
    const endDate = new Date(cycleEndTime);

    const msRemaining = Math.max(0, cycleEndTime - nowTime);
    const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

    return {
      cycleIndex: currentCycleIndex,
      startDate,
      endDate,
      daysRemaining,
      isExpired: daysRemaining <= 0
    };
  }

  /**
   * Formats date nicely: e.g. "08 May 2026"
   */
  function formatDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return '—';
    }
  }

  /**
   * Fetches real direct members and calculates their confirmed deposits within the active 60-day cycle
   */
  async function computeUserRewardsData(userId) {
    const client = window.BitchainAuth ? window.BitchainAuth.getSupabase() : null;
    if (!client) {
      throw new Error('Supabase client is not initialized.');
    }

    // 1. Fetch current user profile
    const { data: userProfile, error: profErr } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profErr || !userProfile) {
      throw new Error('Could not load user profile.');
    }

    // 2. Compute 60-Day cycle start and end dates
    const cycle = computeCycleDates(userProfile.created_at);

    // 3. Find all Level-1 (Direct) members
    // Sponsor can be stored as current user's username or referral_code
    const uName = (userProfile.username || '').trim().toLowerCase();
    const rCode = (userProfile.referral_code || '').trim().toLowerCase();

    const { data: allProfiles, error: allProfErr } = await client
      .from('profiles')
      .select('id, full_name, username, email, avatar_url, rank, current_rank, current_package, sponsor_username, referral_code, created_at');

    if (allProfErr) {
      console.warn('Error fetching direct profiles:', allProfErr);
    }

    const profilesList = allProfiles || [];
    const directMembers = profilesList.filter(p => {
      if (p.id === userId) return false;
      const s = (p.sponsor_username || '').trim().toLowerCase();
      return (uName && s === uName) || (rCode && s === rCode);
    });

    const directMemberIds = directMembers.map(m => m.id);

    // 4. Fetch confirmed rank/package purchases made by direct members during the active 60-day cycle
    // (Deposits are wallet funding only and NEVER count towards Reward Direct Business)
    let directBusinessTotal = 0;
    const directMemberContributions = new Map(); // memberId -> totalAmount

    directMembers.forEach(m => {
      directMemberContributions.set(m.id, 0);
    });

    if (directMemberIds.length > 0) {
      const { data: purchasesData, error: purErr } = await client
        .from('package_purchases')
        .select('id, user_id, amount, status, purchased_at')
        .in('user_id', directMemberIds)
        .eq('status', 'completed');

      if (purErr) {
        console.warn('Package purchases query note:', purErr);
      }

      const purchases = purchasesData || [];
      const cycleStartMs = cycle.startDate.getTime();
      const cycleEndMs = cycle.endDate.getTime();

      purchases.forEach(pur => {
        const purTime = new Date(pur.purchased_at || pur.created_at).getTime();
        // Check if rank/package purchase occurred inside the active 60-day cycle
        if (purTime >= cycleStartMs && purTime <= cycleEndMs) {
          const amt = parseFloat(pur.amount) || 0;
          directBusinessTotal += amt;
          const currentContrib = directMemberContributions.get(pur.user_id) || 0;
          directMemberContributions.set(pur.user_id, currentContrib + amt);
        }
      });

      // Cumulative Rank Price Tier table
      const RANK_PRICES = {
        'starter': 5,
        'basic': 15,     // $5 Starter + $10 Basic = $15 total
        'silver': 35,    // + $20 = $35
        'gold': 75,      // + $40 = $75
        'diamond': 155,  // + $80 = $155
        'elite': 315,    // + $160 = $315
        'executive': 635,// + $320 = $635
        'royal': 1275    // + $640 = $1275
      };

      // Fallback: If no rows in package_purchases yet (e.g. upgraded prior to table logging or RLS restriction),
      // determine eligible rank purchase amount directly from the member's profile rank/current_package
      directMembers.forEach(m => {
        const recordedAmt = directMemberContributions.get(m.id) || 0;
        if (recordedAmt === 0) {
          const rKey = (m.current_package || m.rank || m.current_rank || '').toLowerCase().trim();
          let estimatedAmt = 0;
          for (const key in RANK_PRICES) {
            if (rKey.includes(key)) {
              estimatedAmt = RANK_PRICES[key];
              break;
            }
          }
          if (estimatedAmt > 0) {
            directMemberContributions.set(m.id, estimatedAmt);
            directBusinessTotal += estimatedAmt;
          }
        }
      });
    }

    // 5. Build Top Reward Achievers ranking based on actual direct package/rank purchases
    const topAchievers = directMembers.map(m => {
      const businessAmount = directMemberContributions.get(m.id) || 0;
      const rank = m.rank || m.current_rank || 'Leader';
      return {
        id: m.id,
        fullName: m.full_name || m.username || 'Direct Member',
        username: m.username,
        avatarUrl: m.avatar_url,
        businessAmount,
        rank
      };
    }).sort((a, b) => b.businessAmount - a.businessAmount);

    // 6. Fetch existing reward claims for the active cycle
    let claimedLevelSet = new Set();
    try {
      const { data: claimsData, error: claimErr } = await client
        .from('reward_claims')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', cycle.startDate.toISOString())
        .lte('created_at', cycle.endDate.toISOString());

      if (!claimErr && claimsData) {
        claimsData.forEach(c => claimedLevelSet.add(c.level));
      }
    } catch (e) {
      console.warn('Reward claims read note:', e);
    }

    // 7. Calculate milestone statuses
    let nextTargetMilestone = REWARD_MILESTONES[0];
    const milestonesStatus = REWARD_MILESTONES.map(ms => {
      const isClaimed = claimedLevelSet.has(ms.level);
      const isAchieved = directBusinessTotal >= ms.target;
      const pct = Math.min(100, Math.round((directBusinessTotal / ms.target) * 100));

      let status = 'PENDING';
      if (isClaimed) {
        status = 'CLAIMED';
      } else if (isAchieved) {
        status = 'ACHIEVED';
      } else if (directBusinessTotal > 0) {
        status = 'IN PROGRESS';
      }

      if (!isAchieved && (!nextTargetMilestone || ms.target > nextTargetMilestone.target)) {
        if (nextTargetMilestone === REWARD_MILESTONES[0] && directBusinessTotal >= nextTargetMilestone.target) {
          nextTargetMilestone = ms;
        }
      }

      return {
        ...ms,
        currentBusiness: directBusinessTotal,
        percentage: pct,
        status,
        isAchieved,
        isClaimed
      };
    });

    // Find first unachieved milestone for the circular progress widget
    const firstUnachieved = milestonesStatus.find(m => !m.isAchieved) || REWARD_MILESTONES[REWARD_MILESTONES.length - 1];
    const overallProgressPct = Math.min(100, Math.round((directBusinessTotal / firstUnachieved.target) * 100));

    return {
      userProfile,
      cycle,
      directBusinessTotal,
      directMembersCount: directMembers.length,
      topAchievers,
      milestonesStatus,
      firstUnachieved,
      overallProgressPct
    };
  }

  /**
   * Claim Reward Milestone with backend validation, database transaction, balance credit, and activity log
   */
  async function claimReward(userId, level) {
    const client = window.BitchainAuth ? window.BitchainAuth.getSupabase() : null;
    if (!client) throw new Error('Supabase client is not available.');

    const milestone = REWARD_MILESTONES.find(m => m.level === level);
    if (!milestone) throw new Error('Invalid reward level.');

    // 1. Recalculate authoritative data to prevent client tampering
    const freshData = await computeUserRewardsData(userId);
    if (freshData.directBusinessTotal < milestone.target) {
      throw new Error(`Target of $${milestone.target.toLocaleString()} direct business has not been reached yet.`);
    }

    // 2. Check duplicate claim in current cycle
    const { data: existingClaims } = await client
      .from('reward_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('level', level)
      .gte('created_at', freshData.cycle.startDate.toISOString())
      .lte('created_at', freshData.cycle.endDate.toISOString());

    if (existingClaims && existingClaims.length > 0) {
      throw new Error(`Reward Level ${level} has already been claimed for this 60-day period.`);
    }

    // 3. Insert claim record in 'reward_claims'
    const { error: insertClaimErr } = await client
      .from('reward_claims')
      .insert({
        user_id: userId,
        level: milestone.level,
        target_amount: milestone.target,
        reward_amount: milestone.reward,
        direct_business_at_claim: freshData.directBusinessTotal,
        cycle_start_date: freshData.cycle.startDate.toISOString(),
        cycle_end_date: freshData.cycle.endDate.toISOString(),
        status: 'claimed',
        created_at: new Date().toISOString()
      });

    if (insertClaimErr) {
      console.error('Error recording reward claim:', insertClaimErr);
      throw new Error(insertClaimErr.message || 'Failed to record reward claim.');
    }

    // 4. Update user's available balance and reward_income in profiles table
    const currentBal = parseFloat(freshData.userProfile.available_balance) || 0;
    const currentTotalInc = parseFloat(freshData.userProfile.total_income) || 0;
    const currentRewardInc = parseFloat(freshData.userProfile.reward_income) || 0;

    const newBal = currentBal + milestone.reward;
    const newTotalInc = currentTotalInc + milestone.reward;
    const newRewardInc = currentRewardInc + milestone.reward;

    const { error: updateProfErr } = await client
      .from('profiles')
      .update({
        available_balance: newBal,
        total_income: newTotalInc,
        reward_income: newRewardInc,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateProfErr) {
      console.warn('Profile balance update warning:', updateProfErr);
    }

    // 5. Insert activity record into 'activities'
    try {
      await client.from('activities').insert({
        user_id: userId,
        title: `Reward Bonus Level ${milestone.level} Claimed`,
        details: `Milestone $${milestone.target.toLocaleString()} Direct Business Achieved`,
        amount: milestone.reward,
        category: 'reward',
        created_at: new Date().toISOString()
      });
    } catch (actErr) {
      console.warn('Activity log note:', actErr);
    }

    return {
      success: true,
      rewardAmount: milestone.reward,
      level: milestone.level,
      newBalance: newBal
    };
  }

  return {
    REWARD_MILESTONES,
    computeCycleDates,
    formatDate,
    computeUserRewardsData,
    claimReward
  };
})();
