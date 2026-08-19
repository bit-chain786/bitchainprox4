/* ==========================================================================
   BITCHAIN PRO X — TEAM STRUCTURE & HIERARCHY CALCULATION ENGINE
   10-Level Dynamic Downline Traversal, Real-Time Supabase Integration
   ========================================================================== */

'use strict';

window.BitchainTeam = (function() {
  // Rank definitions with badges & colors
  const RANK_CONFIG = {
    'UNRANKED': { name: 'UNRANKED', icon: '✦', color: '#9d4edd', badgeClass: 'rank-unranked' },
    'STARTER': { name: 'Starter', icon: '🌱', color: '#00f5d4', badgeClass: 'rank-starter' },
    'BASIC': { name: 'Basic', icon: '⚡', color: '#70d6ff', badgeClass: 'rank-basic' },
    'SILVER': { name: 'Silver Leader', icon: '🥈', color: '#e0aaff', badgeClass: 'rank-silver' },
    'GOLD': { name: 'Gold Leader', icon: '🥇', color: '#ffd166', badgeClass: 'rank-gold' },
    'DIAMOND': { name: 'Diamond Master', icon: '💎', color: '#06d6a0', badgeClass: 'rank-diamond' },
    'ELITE': { name: 'Elite Director', icon: '👑', color: '#ff70a6', badgeClass: 'rank-elite' },
    'EXECUTIVE': { name: 'Executive President', icon: '🏆', color: '#ff9770', badgeClass: 'rank-executive' },
    'ROYAL': { name: 'Royal Ambassador', icon: '💠', color: '#c77dff', badgeClass: 'rank-royal' }
  };

  /**
   * Helper to format date cleanly: e.g. "02 Aug 2026"
   */
  function formatJoiningDate(dateStr) {
    if (!dateStr) return '01 Aug 2026';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '01 Aug 2026';
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return '01 Aug 2026';
    }
  }

  /**
   * Helper to safely format phone number with privacy mask option
   */
  function formatPhoneDisplay(phone) {
    if (!phone || phone.trim() === '') return 'Not Provided';
    const clean = phone.trim();
    // Return formatted phone directly
    return clean;
  }

  /**
   * Helper to resolve rank display info
   */
  function getRankInfo(rankStr, currentPackage) {
    const raw = (rankStr || currentPackage || 'UNRANKED').toString().trim().toUpperCase();
    for (const key in RANK_CONFIG) {
      if (raw.includes(key)) {
        return RANK_CONFIG[key];
      }
    }
    return RANK_CONFIG['UNRANKED'];
  }

  /**
   * Authoritative 10-Level Hierarchy Builder
   * Fetches all profiles, builds referral index graph, and computes recursive levels for the given root user.
   */
  async function computeTeamHierarchy(rootUserId) {
    const client = window.BitchainAuth ? window.BitchainAuth.getSupabase() : null;
    if (!client) {
      throw new Error('Supabase client is not available.');
    }

    let profilesList = [];
    try {
      // Fetch only needed lightweight fields to ensure fast network loading
      const { data: allProfiles, error } = await client
        .from('profiles')
        .select('id, username, referral_code, sponsor_username, full_name, current_rank, current_package, phone, created_at, role, rank_value');

      if (!error && allProfiles) {
        profilesList = allProfiles;
      }
    } catch (err) {
      console.warn('Team profiles lightweight fetch note:', err);
    }

    if (profilesList.length === 0) {
      return {
        rootProfile: null,
        levels: Array.from({ length: 10 }, (_, i) => ({ level: i + 1, members: [], count: 0 })),
        levelCounts: Array(10).fill(0),
        directTeamCount: 0,
        downlineTeamCount: 0,
        totalTeamCount: 0
      };
    }

    // Find the root profile
    const rootProfile = profilesList.find(p => p.id === rootUserId);
    if (!rootProfile) {
      return {
        rootProfile: null,
        levels: Array.from({ length: 10 }, (_, i) => ({ level: i + 1, members: [], count: 0 })),
        levelCounts: Array(10).fill(0),
        directTeamCount: 0,
        downlineTeamCount: 0,
        totalTeamCount: 0
      };
    }


    // Build fast lookup by normalized sponsor keys
    // Children can refer to a sponsor by sponsor's username OR sponsor's referral_code
    const profileById = new Map();
    const childrenBySponsorKey = new Map();

    profilesList.forEach(p => {
      profileById.set(p.id, p);

      const sponsorKey = (p.sponsor_username || '').trim().toLowerCase();
      if (sponsorKey) {
        if (!childrenBySponsorKey.has(sponsorKey)) {
          childrenBySponsorKey.set(sponsorKey, []);
        }
        childrenBySponsorKey.get(sponsorKey).push(p);
      }
    });

    /**
     * Function to get direct children of a specific profile
     */
    function getDirectChildren(profile) {
      const results = [];
      const seenIds = new Set();

      const uKey = (profile.username || '').trim().toLowerCase();
      const rKey = (profile.referral_code || '').trim().toLowerCase();

      if (uKey && childrenBySponsorKey.has(uKey)) {
        childrenBySponsorKey.get(uKey).forEach(child => {
          if (child.id !== profile.id && !seenIds.has(child.id)) {
            seenIds.add(child.id);
            results.push(child);
          }
        });
      }

      if (rKey && childrenBySponsorKey.has(rKey)) {
        childrenBySponsorKey.get(rKey).forEach(child => {
          if (child.id !== profile.id && !seenIds.has(child.id)) {
            seenIds.add(child.id);
            results.push(child);
          }
        });
      }

      return results;
    }

    /**
     * Recursively computes the total downline count (all unique descendants up to 10 levels) for any given member.
     */
    function computeDownlineCountForMember(memberProfile, maxDepth = 10) {
      const visited = new Set([memberProfile.id]);
      let currentLevelMembers = getDirectChildren(memberProfile);
      let count = 0;
      let depth = 1;

      while (currentLevelMembers.length > 0 && depth <= maxDepth) {
        const nextLevel = [];
        for (const m of currentLevelMembers) {
          if (!visited.has(m.id)) {
            visited.add(m.id);
            count++;
            const children = getDirectChildren(m);
            for (const child of children) {
              if (!visited.has(child.id)) {
                nextLevel.push(child);
              }
            }
          }
        }
        currentLevelMembers = nextLevel;
        depth++;
      }
      return count;
    }

    // 10-Level Breadth-First-Search (BFS) traversal from root
    // levels[0] = Level 1 (Direct), levels[1] = Level 2, ... levels[9] = Level 10
    const levels = Array.from({ length: 10 }, () => []);
    const visitedGlobal = new Set([rootProfile.id]);
    const membersWithHierarchyData = new Map();

    let currentQueue = getDirectChildren(rootProfile).map(m => ({ profile: m, level: 1, parentId: rootProfile.id }));

    for (let currentLevel = 1; currentLevel <= 10; currentLevel++) {
      const nextQueue = [];

      for (const item of currentQueue) {
        const p = item.profile;
        if (visitedGlobal.has(p.id)) continue;
        visitedGlobal.add(p.id);

        // Compute this member's own downline team count
        const memberDownlineCount = computeDownlineCountForMember(p, 10);
        const rankInfo = getRankInfo(p.rank || p.current_rank, p.current_package || p.package_name);

        const enhancedMember = {
          ...p,
          level: currentLevel,
          parentId: item.parentId,
          rankInfo: rankInfo,
          formattedJoiningDate: formatJoiningDate(p.created_at),
          formattedPhone: formatPhoneDisplay(p.phone),
          downlineTeamCount: memberDownlineCount,
          directTeamCount: getDirectChildren(p).length
        };

        levels[currentLevel - 1].push(enhancedMember);
        membersWithHierarchyData.set(p.id, enhancedMember);

        // Enqueue direct children for next level if within 10 levels
        if (currentLevel < 10) {
          const directChildren = getDirectChildren(p);
          for (const child of directChildren) {
            if (!visitedGlobal.has(child.id)) {
              nextQueue.push({ profile: child, level: currentLevel + 1, parentId: p.id });
            }
          }
        }
      }

      currentQueue = nextQueue;
    }

    // Calculate Summary Totals
    const directTeamCount = levels[0].length;
    let totalTeamCount = 0;
    levels.forEach(lvlList => {
      totalTeamCount += lvlList.length;
    });

    return {
      rootProfile,
      directTeamCount,
      totalTeamCount,
      levels, // Array of 10 arrays (levels[0] to levels[9])
      membersWithHierarchyData, // Map by ID
      getDirectChildren
    };
  }

  return {
    RANK_CONFIG,
    formatJoiningDate,
    formatPhoneDisplay,
    getRankInfo,
    computeTeamHierarchy
  };
})();
