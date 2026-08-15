/* ==========================================================================
   BITCHAIN PRO X — ADMIN PANEL ENGINE
   Role-based access, real Supabase data, all sections
   ========================================================================== */
'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const ADMIN_SUPABASE_URL  = localStorage.getItem('BITCHAIN_SUPABASE_URL')  || 'https://cwzhihzlxbtkuoqsnkin.supabase.co';
const ADMIN_SUPABASE_KEY  = localStorage.getItem('BITCHAIN_SUPABASE_ANON_KEY') || 'sb_publishable_gYl3A7Y660B6Dti6-rY9bA_AeOi0DsR';

const PKG_TIERS = [
  { key: 'starter',   name: 'STARTER',   rank: 'Starter',   price: 5,   icon: '🌱' },
  { key: 'basic',     name: 'BASIC',     rank: 'Basic',     price: 10,  icon: '⚡' },
  { key: 'silver',    name: 'SILVER',    rank: 'Silver',    price: 20,  icon: '🥈' },
  { key: 'gold',      name: 'GOLD',      rank: 'Gold',      price: 40,  icon: '🥇' },
  { key: 'diamond',   name: 'DIAMOND',   rank: 'Diamond',   price: 80,  icon: '💎' },
  { key: 'elite',     name: 'ELITE',     rank: 'Elite',     price: 160, icon: '👑' },
  { key: 'executive', name: 'EXECUTIVE', rank: 'Executive', price: 320, icon: '🏆' },
  { key: 'royal',     name: 'ROYAL',     rank: 'Royal',     price: 640, icon: '💠' }
];

const PAGE_SIZE = 20;

// ── State ──────────────────────────────────────────────────────────────────
let _supabase = null;
let _adminUser = null;
let _adminProfile = null;
let _currentSection = 'dashboard';
let _usersPage = 1;
let _depositsPage = 1;
let _withdrawalsPage = 1;
let _usersFilter = 'all';
let _depositsFilter = 'all';
let _withdrawalsFilter = 'all';
let _usersSearch = '';
let _depositsSearch = '';
let _withdrawalsSearch = '';
let _activeConvId = null;
let _realtimeSub = null;

// ── Supabase init ──────────────────────────────────────────────────────────
function getDB() {
  if (_supabase) return _supabase;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    _supabase = window.supabase.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }
  return _supabase;
}

// ── Utilities ──────────────────────────────────────────────────────────────
function fmt(val) { return parseFloat(val || 0).toFixed(2); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
function truncate(s, n=24) { return s && s.length > n ? s.slice(0, n) + '…' : (s || '—'); }
function initials(name) { return (name || '?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function el(id) { return document.getElementById(id); }

function toast(msg, type='success') {
  let t = el('adminToast');
  if (!t) { t = document.createElement('div'); t.id = 'adminToast'; t.className = 'admin-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'admin-toast ' + type;
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3600);
}

async function auditLog(action, targetUserId=null, targetTable=null, targetId=null, details=null) {
  const db = getDB();
  if (!db || !_adminUser) return;
  try {
    await db.from('audit_logs').insert({
      admin_id: _adminUser.id,
      action,
      target_user_id: targetUserId,
      target_table: targetTable,
      target_id: targetId,
      details,
      created_at: new Date().toISOString()
    });
  } catch (e) { console.warn('Audit log error:', e); }
}

// ── Auth Guard ─────────────────────────────────────────────────────────────
async function adminInit() {
  const db = getDB();
  if (!db) { showDenied('Database connection failed.'); return; }

  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) { window.location.href = 'login.html'; return; }

  _adminUser = user;

  // Check admin role in profiles table
  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr || !profile || profile.role !== 'admin') {
    showDenied('You do not have admin access.');
    return;
  }

  _adminProfile = profile;

  // Hide loading, show layout
  el('adminLoadingOverlay').style.display = 'none';
  el('adminLayout').style.display = 'flex';

  // Populate admin identity
  const nameEl = el('sidebarAdminName');
  if (nameEl) nameEl.textContent = profile.full_name || user.email;
  const avatarEl = el('sidebarAdminAvatar');
  if (avatarEl) {
    if (profile.avatar_url) {
      avatarEl.style.backgroundImage = `url('${profile.avatar_url}')`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.textContent = '';
    } else {
      avatarEl.textContent = initials(profile.full_name);
    }
  }

  // Audit: admin login
  await auditLog('ADMIN_LOGIN');

  // Navigate to dashboard
  navigateTo('dashboard');

  // Load pending counts for badges
  loadBadgeCounts();
}

function showDenied(msg) {
  el('adminLoadingOverlay').style.display = 'none';
  el('adminAccessDenied').classList.add('show');
  const msgEl = el('deniedMessage');
  if (msgEl) msgEl.textContent = msg;
}

// ── Navigation ─────────────────────────────────────────────────────────────
function navigateTo(section, sub=null) {
  _currentSection = section;

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.nav-sub-item').forEach(item => item.classList.remove('active'));

  const navItem = document.querySelector(`[data-nav="${section}"]`);
  if (navItem) navItem.classList.add('active');
  if (sub) {
    const subItem = document.querySelector(`[data-subnav="${sub}"]`);
    if (subItem) subItem.classList.add('active');
  }

  // Show section
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  const sectionEl = el('section-' + section);
  if (sectionEl) sectionEl.classList.add('active');

  // Update breadcrumb
  const labels = {
    dashboard: 'Dashboard', users: 'Users',
    deposits: 'Payments / Deposits', withdrawals: 'Payments / Withdrawals',
    packages: 'Packages & Ranks', chat: 'Chat Support',
    reports: 'Reports', settings: 'Settings', audit: 'Audit Logs'
  };
  const bc = el('topbarBreadcrumb');
  if (bc) bc.textContent = labels[section] || section;

  // Load section data
  switch(section) {
    case 'dashboard':  loadDashboard(); break;
    case 'users':      loadUsers(); break;
    case 'deposits':   loadDeposits(); break;
    case 'withdrawals':loadWithdrawals(); break;
    case 'packages':   loadPackages(); break;
    case 'chat':       loadChat(); break;
    case 'reports':    loadReports(); break;
    case 'settings':   loadSettings(); break;
    case 'audit':      loadAuditLogs(); break;
  }

  // Close mobile sidebar
  closeMobileSidebar();
}

// ── Badge counts ───────────────────────────────────────────────────────────
async function loadBadgeCounts() {
  const db = getDB();
  if (!db) return;
  try {
    const [dep, wd, chat] = await Promise.all([
      db.from('deposits').select('id', {count:'exact',head:true}).eq('status','pending'),
      db.from('withdrawals').select('id', {count:'exact',head:true}).eq('status','pending'),
      db.from('support_conversations').select('id', {count:'exact',head:true}).gt('unread_admin',0)
    ]);
    const depBadge = el('badgeDeposits');
    const wdBadge = el('badgeWithdrawals');
    const chatBadge = el('badgeChat');
    if (depBadge) { depBadge.textContent = dep.count || 0; depBadge.style.display = dep.count ? '' : 'none'; }
    if (wdBadge) { wdBadge.textContent = wd.count || 0; wdBadge.style.display = wd.count ? '' : 'none'; }
    if (chatBadge) { chatBadge.textContent = chat.count || 0; chatBadge.style.display = chat.count ? '' : 'none'; }
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: DASHBOARD
// ══════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const db = getDB();
  if (!db) return;

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [
      totalUsersRes, activeUsersRes, newTodayRes,
      totalDepRes, pendDepRes, appDepRes,
      totalWdRes, pendWdRes, appWdRes,
      totalPkgRes
    ] = await Promise.all([
      db.from('profiles').select('id', {count:'exact',head:true}),
      db.from('profiles').select('id', {count:'exact',head:true}).eq('status','active'),
      db.from('profiles').select('id', {count:'exact',head:true}).gte('created_at', todayStart),
      db.from('deposits').select('amount').eq('status','approved'),
      db.from('deposits').select('id', {count:'exact',head:true}).eq('status','pending'),
      db.from('deposits').select('id', {count:'exact',head:true}).eq('status','approved'),
      db.from('withdrawals').select('amount').eq('status','approved'),
      db.from('withdrawals').select('id', {count:'exact',head:true}).eq('status','pending'),
      db.from('withdrawals').select('id', {count:'exact',head:true}).eq('status','approved'),
      db.from('package_purchases').select('id', {count:'exact',head:true})
    ]);

    const totalDep = (totalDepRes.data || []).reduce((s,r) => s + parseFloat(r.amount||0), 0);
    const totalWd  = (totalWdRes.data || []).reduce((s,r) => s + parseFloat(r.amount||0), 0);

    setStatCard('statTotalUsers',   totalUsersRes.count || 0);
    setStatCard('statActiveUsers',  activeUsersRes.count || 0);
    setStatCard('statNewToday',     newTodayRes.count || 0);
    setStatCard('statTotalDep',    '$' + fmt(totalDep));
    setStatCard('statPendDep',      pendDepRes.count || 0);
    setStatCard('statAppDep',       appDepRes.count || 0);
    setStatCard('statPendWd',       pendWdRes.count || 0);
    setStatCard('statAppWd',        appWdRes.count || 0);
    setStatCard('statTotalPkg',     totalPkgRes.count || 0);

    // Charts
    await loadDashboardCharts();
    await loadRecentActivity();
  } catch(e) {
    console.error('Dashboard load error:', e);
  }
}

function setStatCard(id, value) {
  const el2 = el(id);
  if (el2) el2.textContent = value;
}

async function loadDashboardCharts() {
  const db = getDB();
  if (!db) return;

  // Last 7 days labels
  const days = [];
  const depData = [];
  const userRegData = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1).toISOString();
    days.push(d.toLocaleDateString('en-US', {month:'short', day:'numeric'}));

    const [depRes, userRes] = await Promise.all([
      db.from('deposits').select('amount').gte('created_at', dayStart).lt('created_at', dayEnd).eq('status','approved'),
      db.from('profiles').select('id', {count:'exact',head:true}).gte('created_at', dayStart).lt('created_at', dayEnd)
    ]);
    depData.push((depRes.data || []).reduce((s,r) => s + parseFloat(r.amount||0), 0));
    userRegData.push(userRes.count || 0);
  }

  renderLineChart('chartDeposits7d', days, depData, 'Deposits ($)', '#c77dff');
  renderBarChart('chartUsers7d', days, userRegData, 'New Users', '#3a86ff');
}

function renderLineChart(canvasId, labels, data, label, color) {
  const canvas = el(canvasId);
  if (!canvas || !window.Chart) return;
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: color,
        backgroundColor: color + '18',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: color,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(157,78,221,0.1)' }, ticks: { color: '#b48cdc88', font: {size:11} } },
        y: { grid: { color: 'rgba(157,78,221,0.1)' }, ticks: { color: '#b48cdc88', font: {size:11} }, beginAtZero: true }
      }
    }
  });
}

function renderBarChart(canvasId, labels, data, label, color) {
  const canvas = el(canvasId);
  if (!canvas || !window.Chart) return;
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: color + '44',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(157,78,221,0.1)' }, ticks: { color: '#b48cdc88', font: {size:11} } },
        y: { grid: { color: 'rgba(157,78,221,0.1)' }, ticks: { color: '#b48cdc88', font: {size:11} }, beginAtZero: true }
      }
    }
  });
}

async function loadRecentActivity() {
  const db = getDB();
  if (!db) return;
  const tbody = el('recentActivityTbody');
  if (!tbody) return;

  const { data } = await db.from('audit_logs').select('*').order('created_at', {ascending:false}).limit(10);
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No recent activity</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(log => `
    <tr>
      <td><span class="badge badge-active">${log.action}</span></td>
      <td style="font-size:0.78rem;color:var(--text-muted)">${truncate(log.admin_id,16)}</td>
      <td style="font-size:0.78rem;color:var(--text-muted)">${truncate(log.target_user_id||'—',16)}</td>
      <td style="font-size:0.78rem;color:var(--text-muted)">${fmtDate(log.created_at)}</td>
    </tr>
  `).join('');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: USERS
// ══════════════════════════════════════════════════════════════════════════
async function loadUsers(page=1) {
  _usersPage = page;
  const db = getDB();
  if (!db) return;

  const tbody = el('usersTbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:auto"></div></td></tr>`;

  try {
    let query = db.from('profiles').select('*', {count:'exact'}).order('created_at', {ascending:false});

    if (_usersFilter !== 'all') {
      if (_usersFilter === 'admin') query = query.eq('role','admin');
      else if (_usersFilter === 'active') query = query.eq('status','active');
      else if (_usersFilter === 'inactive') query = query.eq('status','inactive');
    }

    if (_usersSearch) {
      query = query.or(`full_name.ilike.%${_usersSearch}%,username.ilike.%${_usersSearch}%,email.ilike.%${_usersSearch}%`);
    }

    const from = (page - 1) * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);

    const { data, count, error } = await query;

    if (error) throw error;
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">No users found</div><div class="empty-state-sub">No users match your search criteria</div></div></td></tr>`;
      el('usersPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.map(u => `
      <tr>
        <td style="font-size:0.72rem;color:var(--text-muted);font-family:monospace">${truncate(u.id,12)}</td>
        <td>
          <div class="user-cell">
            <div class="user-avatar-xs" style="${u.avatar_url ? `background-image:url('${u.avatar_url}');background-size:cover;background-position:center` : ''}">${u.avatar_url ? '' : initials(u.full_name)}</div>
            <div>
              <div class="user-name-sm">${u.full_name || '—'}</div>
              <div class="user-email-sm">@${u.username || '—'}</div>
            </div>
          </div>
        </td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${u.email || '—'}</td>
        <td><span style="font-size:0.78rem;color:var(--primary-light);font-weight:600">${u.current_package ? u.current_package.toUpperCase() : 'None'}</span></td>
        <td><span style="font-size:0.78rem;color:var(--text-secondary)">${u.current_rank || 'Starter'}</span></td>
        <td><span class="badge ${u.role==='admin'?'badge-admin':'badge-inactive'}">${u.role||'user'}</span></td>
        <td><span class="badge ${u.status==='active'?'badge-active':'badge-inactive'}">${u.status||'active'}</span></td>
        <td style="font-size:0.72rem;color:var(--text-muted)">${fmtDateShort(u.created_at)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="openUserModal('${u.id}')">👁 View</button>
        </td>
      </tr>
    `).join('');

    // Pagination
    renderPagination('usersPagination', count, page, p => loadUsers(p));
  } catch(e) {
    console.error('Users load error:', e);
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">Failed to load users</div></div></td></tr>`;
  }
}

async function openUserModal(userId) {
  const db = getDB();
  if (!db) return;

  const modal = el('userModal');
  if (!modal) return;
  modal.classList.add('active');

  const body = el('userModalBody');
  body.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="margin:auto"></div></div>`;

  const { data: u } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
  const { data: purchases } = await db.from('package_purchases').select('*').eq('user_id', userId).order('purchased_at', {ascending:false}).limit(5);
  const { data: deps } = await db.from('deposits').select('*').eq('user_id', userId).order('created_at', {ascending:false}).limit(5);
  const { data: wds } = await db.from('withdrawals').select('*').eq('user_id', userId).order('created_at', {ascending:false}).limit(5);

  if (!u) { body.innerHTML = '<div class="empty-state"><div class="empty-state-text">User not found</div></div>'; return; }

  const statusBadge = u.status === 'inactive' ? 'badge-inactive' : 'badge-active';

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap">
      <div class="user-avatar-xs" style="width:56px;height:56px;font-size:1.2rem;${u.avatar_url ? `background-image:url('${u.avatar_url}');background-size:cover;background-position:center` : ''}">${u.avatar_url ? '' : initials(u.full_name)}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:800;color:var(--text-primary)">${u.full_name || '—'}</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">@${u.username || '—'} · ${u.email}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="badge ${statusBadge}">${u.status||'active'}</span>
          <span class="badge ${u.role==='admin'?'badge-admin':'badge-inactive'}">${u.role||'user'}</span>
          <span class="badge badge-open">${u.current_rank || 'Starter'}</span>
        </div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        ${u.status === 'active'
          ? `<button class="btn btn-danger btn-sm" onclick="changeUserStatus('${u.id}','inactive')">🔒 Deactivate</button>`
          : `<button class="btn btn-success btn-sm" onclick="changeUserStatus('${u.id}','active')">✓ Activate</button>`
        }
        ${u.role !== 'admin'
          ? `<button class="btn btn-ghost btn-sm" onclick="makeAdmin('${u.id}')">👑 Make Admin</button>`
          : ''
        }
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="glass-card" style="margin:0">
        <div class="glass-card-title" style="margin-bottom:14px">📋 Profile</div>
        <div class="info-grid" style="grid-template-columns:1fr">
          ${infoRow('User ID', truncate(u.id,24))}
          ${infoRow('Phone', u.phone || '—')}
          ${infoRow('Sponsor', u.sponsor_username || '—')}
          ${infoRow('Referral Code', u.referral_code || '—')}
          ${infoRow('Package', u.current_package ? u.current_package.toUpperCase() : 'None')}
          ${infoRow('Registered', fmtDate(u.created_at))}
        </div>
      </div>
      <div class="glass-card" style="margin:0">
        <div class="glass-card-title" style="margin-bottom:14px">💰 Financials</div>
        <div class="info-grid" style="grid-template-columns:1fr">
          ${infoRow('Available Balance', '$' + fmt(u.available_balance))}
          ${infoRow('Total Income', '$' + fmt(u.total_income))}
          ${infoRow('Direct Income', '$' + fmt(u.direct_income))}
          ${infoRow('Team Income', '$' + fmt(u.team_income))}
          ${infoRow('Non-Working Income', '$' + fmt(u.non_working_income))}
          ${infoRow('Total Team', u.total_team || 0)}
        </div>
      </div>
    </div>

    ${purchases && purchases.length ? `
    <div class="glass-card" style="margin:0 0 16px">
      <div class="glass-card-title" style="margin-bottom:12px">📦 Package Purchases</div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Package</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>${purchases.map(p=>`<tr><td>${p.package_name}</td><td>$${fmt(p.amount)}</td><td>${fmtDate(p.purchased_at)}</td><td><span class="badge badge-completed">${p.status}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${deps && deps.length ? `
    <div class="glass-card" style="margin:0 0 16px">
      <div class="glass-card-title" style="margin-bottom:12px">💳 Recent Deposits</div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Amount</th><th>Method</th><th>TxID</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>${deps.map(d=>`<tr><td>$${fmt(d.amount)}</td><td>${d.payment_method}</td><td>${truncate(d.transaction_id,14)}</td><td>${fmtDate(d.created_at)}</td><td><span class="badge badge-${d.status}">${d.status}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${wds && wds.length ? `
    <div class="glass-card" style="margin:0">
      <div class="glass-card-title" style="margin-bottom:12px">💸 Recent Withdrawals</div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Amount</th><th>Method</th><th>Destination</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>${wds.map(w=>`<tr><td>$${fmt(w.amount)}</td><td>${w.withdrawal_method}</td><td>${truncate(w.destination,16)}</td><td>${fmtDate(w.created_at)}</td><td><span class="badge badge-${w.status}">${w.status}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
  `;
}

function infoRow(label, value) {
  return `<div class="info-item"><div class="info-item-label">${label}</div><div class="info-item-value">${value}</div></div>`;
}

async function changeUserStatus(userId, newStatus) {
  const db = getDB();
  if (!db) return;
  const confirmed = await showConfirm(`${newStatus==='active'?'Activate':'Deactivate'} this user?`, newStatus==='active'?'This will restore the user\'s access.':'This will restrict the user\'s access.');
  if (!confirmed) return;
  const { error } = await db.from('profiles').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) { toast('Failed to update user status.', 'error'); return; }
  await auditLog(`USER_STATUS_${newStatus.toUpperCase()}`, userId, 'profiles', userId);
  toast(`User ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully.`, 'success');
  closeModal('userModal');
  loadUsers(_usersPage);
}

async function makeAdmin(userId) {
  const db = getDB();
  if (!db) return;
  const confirmed = await showConfirm('Grant Admin Role?', 'This user will have full admin panel access.');
  if (!confirmed) return;
  const { error } = await db.from('profiles').update({ role: 'admin', updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) { toast('Failed to update role.', 'error'); return; }
  await auditLog('USER_ROLE_ADMIN', userId, 'profiles', userId);
  toast('Admin role granted.', 'success');
  closeModal('userModal');
  loadUsers(_usersPage);
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: DEPOSITS
// ══════════════════════════════════════════════════════════════════════════
async function loadDeposits(page=1) {
  _depositsPage = page;
  const db = getDB();
  if (!db) return;

  const tbody = el('depositsTbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:auto"></div></td></tr>`;

  try {
    let query = db.from('deposits').select('*, profiles!deposits_user_id_fkey(full_name, username, email)', {count:'exact'}).order('created_at', {ascending:false});
    if (_depositsFilter !== 'all') query = query.eq('status', _depositsFilter);
    if (_depositsSearch) query = query.or(`transaction_id.ilike.%${_depositsSearch}%`);

    const from = (page-1)*PAGE_SIZE;
    query = query.range(from, from+PAGE_SIZE-1);
    const { data, count, error } = await query;

    if (error) throw error;
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">💳</div><div class="empty-state-text">No deposit requests found</div></div></td></tr>`;
      el('depositsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.map(d => {
      const p = d.profiles || {};
      return `
        <tr>
          <td style="font-size:0.72rem;color:var(--text-muted);font-family:monospace">${truncate(d.id,12)}</td>
          <td>
            <div class="user-cell">
              <div class="user-avatar-xs">${initials(p.full_name)}</div>
              <div><div class="user-name-sm">${p.full_name||'—'}</div><div class="user-email-sm">@${p.username||'—'}</div></div>
            </div>
          </td>
          <td><span style="font-size:1rem;font-weight:800;color:var(--accent-green)">$${fmt(d.amount)}</span></td>
          <td style="font-size:0.8rem">${d.payment_method}</td>
          <td style="font-size:0.72rem;color:var(--text-muted);font-family:monospace">${truncate(d.transaction_id,16)||'—'}</td>
          <td style="font-size:0.72rem;color:var(--text-muted)">${fmtDate(d.created_at)}</td>
          <td><span class="badge badge-${d.status}">${d.status}</span></td>
          <td><button class="btn btn-ghost btn-sm" onclick="openDepositModal('${d.id}')">👁 Review</button></td>
        </tr>
      `;
    }).join('');

    renderPagination('depositsPagination', count, page, p => loadDeposits(p));
  } catch(e) {
    console.error('Deposits load error:', e);
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">Failed to load deposits</div></div></td></tr>`;
  }
}

async function openDepositModal(depositId) {
  const db = getDB();
  if (!db) return;
  const modal = el('depositModal');
  if (!modal) return;
  modal.classList.add('active');
  const body = el('depositModalBody');
  body.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="margin:auto"></div></div>`;

  const { data: d } = await db.from('deposits').select('*, profiles!deposits_user_id_fkey(full_name, username, email, available_balance)').eq('id', depositId).maybeSingle();
  if (!d) { body.innerHTML = '<div class="empty-state"><div class="empty-state-text">Deposit not found</div></div>'; return; }

  const p = d.profiles || {};
  const isPending = d.status === 'pending';

  body.innerHTML = `
    <div class="info-grid">
      ${infoRow('Deposit ID', truncate(d.id,24))}
      ${infoRow('User', p.full_name || '—')}
      ${infoRow('Username', '@' + (p.username||'—'))}
      ${infoRow('Email', p.email||'—')}
      ${infoRow('Amount', '<strong style="color:var(--accent-green);font-size:1.1rem">$'+fmt(d.amount)+' USDT</strong>')}
      ${infoRow('Payment Method', d.payment_method)}
      ${infoRow('Transaction ID', d.transaction_id||'—')}
      ${infoRow('Status', `<span class="badge badge-${d.status}">${d.status}</span>`)}
      ${infoRow('Submitted', fmtDate(d.created_at))}
      ${infoRow('Admin Notes', d.admin_notes||'—')}
    </div>
    ${d.proof_url ? `<div style="margin-top:12px"><img src="${d.proof_url}" alt="Proof" style="max-width:100%;border-radius:8px;border:1px solid var(--admin-border)"></div>` : ''}
    ${isPending ? `
    <div style="margin-top:20px">
      <div class="form-group">
        <label class="form-label">Admin Notes (optional)</label>
        <textarea class="form-control" id="depAdminNotes" placeholder="Add notes for this deposit…"></textarea>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-success" onclick="processDeposit('${d.id}','${d.user_id}',${d.amount},'approved')">✓ Approve Deposit</button>
        <button class="btn btn-danger" onclick="processDeposit('${d.id}','${d.user_id}',${d.amount},'rejected')">✕ Reject</button>
      </div>
    </div>` : ''}
  `;
}

async function processDeposit(depositId, userId, amount, newStatus) {
  const db = getDB();
  if (!db) return;

  const isApprove = newStatus === 'approved';
  const notes = el('depAdminNotes')?.value?.trim() || '';

  const confirmed = await showConfirm(
    isApprove ? '✓ Approve Deposit?' : '✕ Reject Deposit?',
    isApprove ? `$${fmt(amount)} will be credited to the user's balance.` : 'The deposit will be rejected.'
  );
  if (!confirmed) return;

  const btn = document.querySelector('#depositModal .btn-success, #depositModal .btn-danger');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

  try {
    // Update deposit status
    const { error: depErr } = await db.from('deposits').update({
      status: newStatus,
      admin_notes: notes,
      reviewed_by: _adminUser.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', depositId).eq('status', 'pending'); // prevent double processing

    if (depErr) throw new Error(depErr.message);

    // If approved, credit user balance
    if (isApprove) {
      // Fetch current balance first
      const { data: profile } = await db.from('profiles').select('available_balance').eq('id', userId).maybeSingle();
      const currentBalance = parseFloat(profile?.available_balance || 0);
      const newBalance = currentBalance + parseFloat(amount);

      const { error: balErr } = await db.from('profiles').update({
        available_balance: newBalance,
        updated_at: new Date().toISOString()
      }).eq('id', userId);

      if (balErr) throw new Error('Balance update failed: ' + balErr.message);
    }

    await auditLog(`DEPOSIT_${newStatus.toUpperCase()}`, userId, 'deposits', depositId, { amount, notes });
    toast(`Deposit ${newStatus} successfully.`, isApprove ? 'success' : 'warning');
    closeModal('depositModal');
    loadDeposits(_depositsPage);
    loadBadgeCounts();
  } catch(e) {
    console.error('Process deposit error:', e);
    toast(e.message || 'Failed to process deposit.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = isApprove ? '✓ Approve Deposit' : '✕ Reject'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: WITHDRAWALS
// ══════════════════════════════════════════════════════════════════════════
async function loadWithdrawals(page=1) {
  _withdrawalsPage = page;
  const db = getDB();
  if (!db) return;

  const tbody = el('withdrawalsTbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:auto"></div></td></tr>`;

  try {
    let query = db.from('withdrawals').select('*, profiles!withdrawals_user_id_fkey(full_name, username, email, available_balance)', {count:'exact'}).order('created_at', {ascending:false});
    if (_withdrawalsFilter !== 'all') query = query.eq('status', _withdrawalsFilter);
    if (_withdrawalsSearch) query = query.ilike('destination', `%${_withdrawalsSearch}%`);

    const from = (page-1)*PAGE_SIZE;
    query = query.range(from, from+PAGE_SIZE-1);
    const { data, count, error } = await query;

    if (error) throw error;
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">💸</div><div class="empty-state-text">No withdrawal requests found</div></div></td></tr>`;
      el('withdrawalsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.map(w => {
      const p = w.profiles || {};
      return `
        <tr>
          <td style="font-size:0.72rem;color:var(--text-muted);font-family:monospace">${truncate(w.id,12)}</td>
          <td>
            <div class="user-cell">
              <div class="user-avatar-xs">${initials(p.full_name)}</div>
              <div><div class="user-name-sm">${p.full_name||'—'}</div><div class="user-email-sm">@${p.username||'—'}</div></div>
            </div>
          </td>
          <td><span style="font-size:1rem;font-weight:800;color:var(--accent-red)">$${fmt(w.amount)}</span></td>
          <td style="font-size:0.8rem">${w.withdrawal_method}</td>
          <td style="font-size:0.72rem;color:var(--text-muted)">${truncate(w.destination,20)}</td>
          <td style="font-size:0.72rem;color:var(--text-muted)">${fmtDate(w.created_at)}</td>
          <td><span class="badge badge-${w.status}">${w.status}</span></td>
          <td><button class="btn btn-ghost btn-sm" onclick="openWithdrawalModal('${w.id}')">👁 Review</button></td>
        </tr>
      `;
    }).join('');

    renderPagination('withdrawalsPagination', count, page, p => loadWithdrawals(p));
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">Failed to load withdrawals</div></div></td></tr>`;
  }
}

async function openWithdrawalModal(wdId) {
  const db = getDB();
  if (!db) return;
  const modal = el('withdrawalModal');
  if (!modal) return;
  modal.classList.add('active');
  const body = el('withdrawalModalBody');
  body.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="margin:auto"></div></div>`;

  const { data: w } = await db.from('withdrawals').select('*, profiles!withdrawals_user_id_fkey(full_name, username, email, available_balance)').eq('id', wdId).maybeSingle();
  if (!w) { body.innerHTML = '<div class="empty-state"><div class="empty-state-text">Withdrawal not found</div></div>'; return; }

  const p = w.profiles || {};
  const isPending = w.status === 'pending';
  const canProcess = parseFloat(p.available_balance || 0) >= parseFloat(w.amount);

  body.innerHTML = `
    <div class="info-grid">
      ${infoRow('Withdrawal ID', truncate(w.id,24))}
      ${infoRow('User', p.full_name||'—')}
      ${infoRow('Username', '@'+(p.username||'—'))}
      ${infoRow('Available Balance', '<strong style="color:var(--accent-green)">$'+fmt(p.available_balance)+'</strong>')}
      ${infoRow('Requested Amount', '<strong style="color:var(--accent-red);font-size:1.1rem">$'+fmt(w.amount)+' USDT</strong>')}
      ${!canProcess && isPending ? `<div style="grid-column:1/-1"><div style="background:rgba(230,57,70,0.1);border:1px solid rgba(230,57,70,0.3);border-radius:8px;padding:10px;color:#e63946;font-size:0.82rem;font-weight:600">⚠️ Insufficient balance — user only has $${fmt(p.available_balance)}</div></div>` : ''}
      ${infoRow('Method', w.withdrawal_method)}
      ${infoRow('Destination', w.destination)}
      ${infoRow('Status', `<span class="badge badge-${w.status}">${w.status}</span>`)}
      ${infoRow('Submitted', fmtDate(w.created_at))}
      ${w.rejection_reason ? infoRow('Rejection Reason', w.rejection_reason) : ''}
    </div>
    ${isPending ? `
    <div style="margin-top:20px">
      <div class="form-group">
        <label class="form-label">Admin Notes / Rejection Reason</label>
        <textarea class="form-control" id="wdAdminNotes" placeholder="Required when rejecting…"></textarea>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-success" onclick="processWithdrawal('${w.id}','${w.user_id}',${w.amount},'approved')" ${!canProcess ? 'disabled title="Insufficient balance"' : ''}>✓ Process Withdrawal</button>
        <button class="btn btn-danger" onclick="processWithdrawal('${w.id}','${w.user_id}',${w.amount},'rejected')">✕ Reject</button>
      </div>
    </div>` : ''}
  `;
}

async function processWithdrawal(wdId, userId, amount, newStatus) {
  const db = getDB();
  if (!db) return;

  const isApprove = newStatus === 'approved';
  const notes = el('wdAdminNotes')?.value?.trim() || '';

  if (!isApprove && !notes) { toast('Please provide a rejection reason.', 'warning'); return; }

  const confirmed = await showConfirm(
    isApprove ? '✓ Process Withdrawal?' : '✕ Reject Withdrawal?',
    isApprove ? `$${fmt(amount)} will be deducted from the user's balance.` : `Withdrawal will be rejected: "${notes}"`
  );
  if (!confirmed) return;

  try {
    // Server-side balance verification before deducting
    if (isApprove) {
      const { data: profile } = await db.from('profiles').select('available_balance').eq('id', userId).maybeSingle();
      const currentBalance = parseFloat(profile?.available_balance || 0);
      if (currentBalance < parseFloat(amount)) {
        toast('Insufficient balance. Cannot process withdrawal.', 'error');
        return;
      }

      // Deduct balance
      const { error: balErr } = await db.from('profiles').update({
        available_balance: currentBalance - parseFloat(amount),
        updated_at: new Date().toISOString()
      }).eq('id', userId);
      if (balErr) throw new Error(balErr.message);
    }

    // Update withdrawal
    const { error } = await db.from('withdrawals').update({
      status: newStatus,
      admin_notes: notes,
      rejection_reason: !isApprove ? notes : null,
      reviewed_by: _adminUser.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', wdId).eq('status','pending');

    if (error) throw new Error(error.message);

    await auditLog(`WITHDRAWAL_${newStatus.toUpperCase()}`, userId, 'withdrawals', wdId, { amount, notes });
    toast(`Withdrawal ${newStatus} successfully.`, isApprove ? 'success' : 'warning');
    closeModal('withdrawalModal');
    loadWithdrawals(_withdrawalsPage);
    loadBadgeCounts();
  } catch(e) {
    toast(e.message || 'Failed to process withdrawal.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: PACKAGES
// ══════════════════════════════════════════════════════════════════════════
async function loadPackages() {
  const db = getDB();
  if (!db) return;
  const grid = el('packagesGrid');
  if (!grid) return;
  grid.innerHTML = PKG_TIERS.map(t => `<div class="pkg-admin-card" style="opacity:0.6"><div class="pkg-admin-icon">${t.icon}</div><div class="pkg-admin-name">${t.name}</div><div class="pkg-admin-price">$${t.price}</div><div class="pkg-admin-stat">Loading…</div></div>`).join('');

  const results = await Promise.all(PKG_TIERS.map(t =>
    db.from('profiles').select('id', {count:'exact',head:true}).eq('current_package', t.key)
  ));
  const pCounts = await Promise.all(PKG_TIERS.map(t =>
    db.from('package_purchases').select('id', {count:'exact',head:true}).eq('package_key', t.key)
  ));

  grid.innerHTML = PKG_TIERS.map((t,i) => `
    <div class="pkg-admin-card" onclick="openPkgModal('${t.key}')">
      <div class="pkg-admin-icon">${t.icon}</div>
      <div class="pkg-admin-name">${t.name}</div>
      <div class="pkg-admin-price">$${t.price}</div>
      <div class="pkg-admin-stat">
        <span>${results[i].count || 0}</span> active users ·
        <span>${pCounts[i].count || 0}</span> purchases
      </div>
    </div>
  `).join('');
}

async function openPkgModal(pkgKey) {
  const db = getDB();
  if (!db) return;
  const tier = PKG_TIERS.find(t => t.key === pkgKey);
  if (!tier) return;

  const modal = el('pkgModal');
  if (!modal) return;
  el('pkgModalTitle').textContent = `${tier.icon} ${tier.name} Package — Users`;
  modal.classList.add('active');

  const body = el('pkgModalBody');
  body.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="margin:auto"></div></div>`;

  const { data } = await db.from('profiles').select('id,full_name,username,email,created_at').eq('current_package', pkgKey).order('created_at', {ascending:false});
  if (!data || data.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${tier.icon}</div><div class="empty-state-text">No users on ${tier.name} package</div></div>`;
    return;
  }

  body.innerHTML = `
    <div class="table-wrap">
      <table class="admin-table">
        <thead><tr><th>User</th><th>Email</th><th>Joined</th></tr></thead>
        <tbody>${data.map(u=>`
          <tr>
            <td><div class="user-cell"><div class="user-avatar-xs">${initials(u.full_name)}</div><div><div class="user-name-sm">${u.full_name}</div><div class="user-email-sm">@${u.username}</div></div></div></td>
            <td style="font-size:0.8rem;color:var(--text-muted)">${u.email}</td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${fmtDateShort(u.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: CHAT SUPPORT
// ══════════════════════════════════════════════════════════════════════════
async function loadChat() {
  const db = getDB();
  if (!db) return;
  const list = el('chatConvList');
  if (!list) return;
  list.innerHTML = `<div class="empty-state" style="padding:30px"><div class="loading-spinner" style="margin:auto"></div></div>`;

  const { data } = await db.from('support_conversations').select('*, profiles!support_conversations_user_id_fkey(full_name, username)').order('updated_at', {ascending:false}).limit(50);

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-state-icon">💬</div><div class="empty-state-text">No support conversations yet</div></div>`;
    return;
  }

  list.innerHTML = data.map(c => {
    const p = c.profiles || {};
    return `
      <div class="chat-list-item ${_activeConvId === c.id ? 'active' : ''}" onclick="openConversation('${c.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div class="chat-list-user">${p.full_name || 'Unknown'}</div>
          ${c.unread_admin > 0 ? `<span class="chat-unread">${c.unread_admin}</span>` : ''}
          <span class="badge badge-${c.status === 'resolved' ? 'resolved' : 'open'}" style="font-size:0.62rem">${c.status}</span>
        </div>
        <div class="chat-list-preview">${c.last_message || 'No messages yet'}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px">${fmtDate(c.last_message_at || c.created_at)}</div>
      </div>
    `;
  }).join('');
}

async function openConversation(convId) {
  _activeConvId = convId;
  const db = getDB();
  if (!db) return;

  // Mark as read
  await db.from('support_conversations').update({ unread_admin: 0 }).eq('id', convId);

  // Refresh list
  loadChat();

  const win = el('chatWindow');
  if (win) win.style.display = 'flex';

  const header = el('chatWindowHeader');
  const { data: conv } = await db.from('support_conversations').select('*, profiles!support_conversations_user_id_fkey(full_name, username)').eq('id', convId).maybeSingle();
  if (conv && header) {
    const p = conv.profiles || {};
    header.innerHTML = `
      <div>
        <div style="font-size:0.9rem;font-weight:700;color:var(--text-primary)">${p.full_name || 'Unknown'} (@${p.username || '—'})</div>
        <div style="font-size:0.72rem;color:var(--text-muted)">${conv.subject || 'General Support'} · <span class="badge badge-${conv.status==='resolved'?'resolved':'open'}">${conv.status}</span></div>
      </div>
      <div style="display:flex;gap:8px">
        ${conv.status !== 'resolved' ? `<button class="btn btn-success btn-sm" onclick="resolveConv('${convId}')">✓ Resolve</button>` : ''}
      </div>
    `;
  }

  // Load messages
  await loadMessages(convId);

  // Subscribe to real-time
  if (_realtimeSub) _realtimeSub.unsubscribe();
  _realtimeSub = db.channel('conv-' + convId)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'support_messages', filter:`conversation_id=eq.${convId}` }, () => loadMessages(convId))
    .subscribe();
}

async function loadMessages(convId) {
  const db = getDB();
  if (!db) return;
  const box = el('chatMessages');
  if (!box) return;

  const { data } = await db.from('support_messages').select('*').eq('conversation_id', convId).order('created_at', {ascending:true});
  if (!data || data.length === 0) {
    box.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><div class="empty-state-text">No messages yet</div></div>`;
    return;
  }

  box.innerHTML = data.map(m => `
    <div class="chat-msg ${m.sender_role === 'admin' ? 'admin' : 'user'}">
      <div>${m.message}</div>
      <div class="chat-msg-time">${fmtDate(m.created_at)}</div>
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendAdminMessage() {
  if (!_activeConvId) return;
  const input = el('chatAdminInput');
  const msg = input?.value?.trim();
  if (!msg) return;

  const db = getDB();
  if (!db || !_adminUser) return;

  input.value = '';
  input.disabled = true;

  const { error } = await db.from('support_messages').insert({
    conversation_id: _activeConvId,
    sender_id: _adminUser.id,
    sender_role: 'admin',
    message: msg,
    created_at: new Date().toISOString()
  });

  if (!error) {
    await db.from('support_conversations').update({
      last_message: msg,
      last_message_at: new Date().toISOString(),
      unread_user: 1,
      updated_at: new Date().toISOString()
    }).eq('id', _activeConvId);
    loadMessages(_activeConvId);
  } else {
    toast('Failed to send message.', 'error');
    input.value = msg;
  }
  input.disabled = false;
  input.focus();
}

async function resolveConv(convId) {
  const db = getDB();
  if (!db) return;
  await db.from('support_conversations').update({ status: 'resolved', updated_at: new Date().toISOString() }).eq('id', convId);
  await auditLog('CONVERSATION_RESOLVED', null, 'support_conversations', convId);
  toast('Conversation marked as resolved.', 'success');
  loadChat();
  if (_activeConvId === convId) openConversation(convId);
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: REPORTS
// ══════════════════════════════════════════════════════════════════════════
async function loadReports(range='30') {
  const db = getDB();
  if (!db) return;

  let startDate;
  const now = new Date();
  switch(range) {
    case '1':  startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case '7':  startDate = new Date(now - 7*24*60*60*1000); break;
    case '30': startDate = new Date(now - 30*24*60*60*1000); break;
    case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    default: startDate = new Date(now - 30*24*60*60*1000);
  }
  const iso = startDate.toISOString();

  try {
    const [users, newUsers, activePkg, deps, wds, pkgPurch] = await Promise.all([
      db.from('profiles').select('id', {count:'exact',head:true}),
      db.from('profiles').select('id', {count:'exact',head:true}).gte('created_at', iso),
      db.from('profiles').select('current_package').not('current_package','is',null),
      db.from('deposits').select('amount,status').gte('created_at', iso),
      db.from('withdrawals').select('amount,status').gte('created_at', iso),
      db.from('package_purchases').select('package_key,amount').gte('purchased_at', iso)
    ]);

    // User report
    const ur = el('reportUsers');
    if (ur) ur.innerHTML = `
      ${reportRow('Total Users', users.count || 0)}
      ${reportRow('New in Period', newUsers.count || 0)}
      ${reportRow('With Active Package', (activePkg.data||[]).length)}
    `;

    // Financial report
    const depApproved = (deps.data||[]).filter(d=>d.status==='approved');
    const depPending  = (deps.data||[]).filter(d=>d.status==='pending');
    const depRejected = (deps.data||[]).filter(d=>d.status==='rejected');
    const wdApproved  = (wds.data||[]).filter(w=>w.status==='approved');
    const wdPending   = (wds.data||[]).filter(w=>w.status==='pending');

    const fr = el('reportFinancial');
    if (fr) fr.innerHTML = `
      ${reportRow('Total Deposits (Approved)', '$' + fmt((depApproved).reduce((s,d)=>s+parseFloat(d.amount),0)))}
      ${reportRow('Pending Deposits', depPending.length)}
      ${reportRow('Rejected Deposits', depRejected.length)}
      ${reportRow('Total Withdrawals (Processed)', '$' + fmt((wdApproved).reduce((s,w)=>s+parseFloat(w.amount),0)))}
      ${reportRow('Pending Withdrawals', wdPending.length)}
    `;

    // Package report
    const pkgCounts = {};
    (pkgPurch.data||[]).forEach(p => { pkgCounts[p.package_key] = (pkgCounts[p.package_key]||0)+1; });
    const pkgRevenue = (pkgPurch.data||[]).reduce((s,p)=>s+parseFloat(p.amount||0),0);

    const pr = el('reportPackages');
    if (pr) pr.innerHTML = `
      ${reportRow('Total Purchases', (pkgPurch.data||[]).length)}
      ${reportRow('Total Revenue', '$' + fmt(pkgRevenue))}
      ${PKG_TIERS.map(t => reportRow(t.name, pkgCounts[t.key] || 0)).join('')}
    `;

  } catch(e) {
    console.error('Reports error:', e);
  }
}

function reportRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(157,78,221,0.06)">
      <span style="font-size:0.85rem;color:var(--text-secondary)">${label}</span>
      <span style="font-size:0.9rem;font-weight:700;color:var(--text-primary)">${value}</span>
    </div>
  `;
}

function exportCSV(section) {
  toast('CSV export coming soon. Connect a server-side function for secure export.', 'info');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: SETTINGS
// ══════════════════════════════════════════════════════════════════════════
async function loadSettings() {
  if (!_adminProfile) return;
  const nameEl = el('settingsName');
  const emailEl = el('settingsEmail');
  if (nameEl) nameEl.value = _adminProfile.full_name || '';
  if (emailEl) emailEl.value = _adminProfile.email || '';
}

async function saveAdminProfile() {
  const db = getDB();
  if (!db || !_adminUser) return;
  const name = el('settingsName')?.value?.trim();
  if (!name) { toast('Name cannot be empty.', 'error'); return; }

  const { error } = await db.from('profiles').update({ full_name: name, updated_at: new Date().toISOString() }).eq('id', _adminUser.id);
  if (error) { toast('Failed to save profile.', 'error'); return; }
  _adminProfile.full_name = name;
  el('sidebarAdminName').textContent = name;
  await auditLog('ADMIN_PROFILE_UPDATE');
  toast('Profile updated successfully.', 'success');
}

async function changeAdminPassword() {
  const db = getDB();
  if (!db) return;
  const pw = el('settingsNewPw')?.value?.trim();
  const pw2 = el('settingsNewPw2')?.value?.trim();
  if (!pw || pw.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
  if (pw !== pw2) { toast('Passwords do not match.', 'error'); return; }

  const { error } = await db.auth.updateUser({ password: pw });
  if (error) { toast('Failed to change password: ' + error.message, 'error'); return; }
  await auditLog('ADMIN_PASSWORD_CHANGE');
  toast('Password changed successfully.', 'success');
  el('settingsNewPw').value = '';
  el('settingsNewPw2').value = '';
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION: AUDIT LOGS
// ══════════════════════════════════════════════════════════════════════════
async function loadAuditLogs() {
  const db = getDB();
  if (!db) return;
  const tbody = el('auditTbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:auto"></div></td></tr>`;

  const { data, error } = await db.from('audit_logs').select('*').order('created_at', {ascending:false}).limit(100);

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No audit logs yet</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(l => `
    <tr>
      <td style="font-size:0.72rem;font-family:monospace;color:var(--text-muted)">${truncate(l.admin_id,14)}</td>
      <td><span class="badge badge-active" style="font-size:0.68rem">${l.action}</span></td>
      <td style="font-size:0.72rem;font-family:monospace;color:var(--text-muted)">${truncate(l.target_user_id||'—',14)}</td>
      <td style="font-size:0.78rem;color:var(--text-muted)">${l.target_table||'—'}</td>
      <td style="font-size:0.72rem;color:var(--text-muted)">${fmtDate(l.created_at)}</td>
    </tr>
  `).join('');
}

// ── Pagination ─────────────────────────────────────────────────────────────
function renderPagination(containerId, total, currentPage, onPage) {
  const container = el(containerId);
  if (!container) return;
  const totalPages = Math.ceil((total||0) / PAGE_SIZE);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  html += `<button class="page-btn" onclick="(${onPage})(${currentPage-1})" ${currentPage<=1?'disabled':''}>‹</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      html += `<button class="page-btn ${i===currentPage?'active':''}" onclick="(${onPage})(${i})">${i}</button>`;
    } else if (Math.abs(i - currentPage) === 2) {
      html += `<span style="color:var(--text-muted);padding:0 4px">…</span>`;
    }
  }
  html += `<button class="page-btn" onclick="(${onPage})(${currentPage+1})" ${currentPage>=totalPages?'disabled':''}>›</button>`;
  container.innerHTML = html;
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function closeModal(id) {
  const m = el(id);
  if (m) m.classList.remove('active');
}

// ── Confirm dialog ─────────────────────────────────────────────────────────
function showConfirm(title, message) {
  return new Promise(resolve => {
    const backdrop = el('confirmBackdrop');
    if (!backdrop) { resolve(confirm(message)); return; }
    el('confirmTitle').textContent = title;
    el('confirmMessage').textContent = message;
    backdrop.classList.add('active');
    const ok = el('confirmOk');
    const cancel = el('confirmCancel');
    function cleanup() { backdrop.classList.remove('active'); ok.onclick = null; cancel.onclick = null; }
    ok.onclick = () => { cleanup(); resolve(true); };
    cancel.onclick = () => { cleanup(); resolve(false); };
  });
}

// ── Sidebar collapse ───────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = el('adminSidebar');
  if (sidebar) sidebar.classList.toggle('collapsed');
}

function toggleMobileSidebar() {
  const sidebar = el('adminSidebar');
  const overlay = el('mobileOverlay');
  sidebar?.classList.toggle('mobile-open');
  overlay?.classList.toggle('show');
}

function closeMobileSidebar() {
  const sidebar = el('adminSidebar');
  const overlay = el('mobileOverlay');
  sidebar?.classList.remove('mobile-open');
  overlay?.classList.remove('show');
}

// ── Logout ─────────────────────────────────────────────────────────────────
async function adminLogout() {
  const db = getDB();
  if (!db) { window.location.href = 'login.html'; return; }
  await auditLog('ADMIN_LOGOUT');
  await db.auth.signOut();
  localStorage.removeItem('bitchain_user_profile');
  window.location.href = 'login.html';
}

// ── Submenu toggle ─────────────────────────────────────────────────────────
function toggleSubmenu(id) {
  const sub = el(id);
  const item = sub?.previousElementSibling;
  if (sub) sub.classList.toggle('open');
  if (item) item.classList.toggle('submenu-open');
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Supabase SDK to load
  let attempts = 0;
  function tryInit() {
    attempts++;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      adminInit();
    } else if (attempts < 20) {
      setTimeout(tryInit, 200);
    } else {
      showDenied('Failed to load authentication library.');
    }
  }
  tryInit();
});
