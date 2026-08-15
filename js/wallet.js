/* ==========================================================================
   BITCHAIN PRO X — WALLET MODULE (Deposit & Withdraw)
   Handles BEP-20 USDT Deposits, Withdrawals, Real-time calculations,
   Supabase integration, and Admin Approval sync.
   ========================================================================== */

const DEPOSIT_BEP20_ADDRESS = "0xAad5D80043CEBb13cE4292F1Ea8f0615cF94D8c5";
const MIN_DEPOSIT_USDT = 5;
const MIN_WITHDRAW_USDT = 2;
const WITHDRAW_FEE_PERCENT = 0.02; // 2%

let selectedProofFile = null;

/**
 * Copies the deposit wallet address to clipboard with UI feedback
 */
function copyDepositAddress() {
  const addressInput = document.getElementById('bep20DepositAddress');
  const copyBtn = document.getElementById('btnCopyDepositAddr');
  const copyIcon = document.getElementById('copyDepositIcon');
  
  if (addressInput) {
    navigator.clipboard.writeText(DEPOSIT_BEP20_ADDRESS).then(() => {
      showWalletToast('✅ Wallet address copied to clipboard!', 'success');
      if (copyBtn) {
        copyBtn.style.color = '#00f5d4';
        setTimeout(() => { copyBtn.style.color = ''; }, 2000);
      }
    }).catch(() => {
      addressInput.select();
      document.execCommand('copy');
      showWalletToast('✅ Copied!', 'success');
    });
  }
}

/**
 * Calculates deposit receive amount
 */
function calcDepositReceive() {
  const amtInput = document.getElementById('depositAmount');
  const val = parseFloat(amtInput?.value || 0);
  const receiveEl = document.getElementById('depositReceiveVal');
  if (receiveEl) {
    receiveEl.textContent = (isNaN(val) || val <= 0 ? '0.00' : val.toFixed(2)) + ' USDT';
  }
}

/**
 * Calculates withdrawal fee and net receive amount
 */
function calcWithdrawReceive() {
  const amtInput = document.getElementById('withdrawAmount');
  const val = parseFloat(amtInput?.value || 0);
  const feeEl = document.getElementById('withdrawFeeVal');
  const receiveEl = document.getElementById('withdrawReceiveVal');
  
  if (isNaN(val) || val <= 0) {
    if (feeEl) feeEl.textContent = '0.00 USDT (2%)';
    if (receiveEl) receiveEl.textContent = '0.00 USDT';
    return;
  }
  
  const fee = val * WITHDRAW_FEE_PERCENT;
  const net = Math.max(0, val - fee);
  
  if (feeEl) feeEl.textContent = `${fee.toFixed(2)} USDT (2%)`;
  if (receiveEl) receiveEl.textContent = `${net.toFixed(2)} USDT`;
}

/**
 * Handle Proof Screenshot File Select (OPTIONAL)
 */
function handleProofSelect(e) {
  const file = e.target.files && e.target.files[0];
  const nameEl = document.getElementById('proofFileName');
  const previewWrap = document.getElementById('proofPreviewWrap');
  const previewImg = document.getElementById('proofPreviewImg');
  const uploadPrompt = document.getElementById('proofUploadPrompt');
  
  if (!file) {
    selectedProofFile = null;
    if (nameEl) { nameEl.style.display = 'none'; nameEl.textContent = ''; }
    if (previewWrap) previewWrap.style.display = 'none';
    if (uploadPrompt) uploadPrompt.style.display = 'block';
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    showWalletToast('File size must be under 5MB.', 'error');
    e.target.value = '';
    return;
  }
  
  selectedProofFile = file;
  if (nameEl) {
    nameEl.style.display = 'block';
    nameEl.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }
  
  // Show image preview
  if (previewWrap && previewImg) {
    const reader = new FileReader();
    reader.onload = function(ev) {
      previewImg.src = ev.target.result;
      previewWrap.style.display = 'block';
      if (uploadPrompt) uploadPrompt.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

function removeProofFile(e) {
  if (e) e.stopPropagation();
  selectedProofFile = null;
  const fileInput = document.getElementById('proofFileInput');
  if (fileInput) fileInput.value = '';
  const nameEl = document.getElementById('proofFileName');
  if (nameEl) { nameEl.style.display = 'none'; nameEl.textContent = ''; }
  const previewWrap = document.getElementById('proofPreviewWrap');
  if (previewWrap) previewWrap.style.display = 'none';
  const uploadPrompt = document.getElementById('proofUploadPrompt');
  if (uploadPrompt) uploadPrompt.style.display = 'block';
}

/**
 * Submit Deposit Request to Supabase
 */
async function submitDeposit() {
  const amtInput = document.getElementById('depositAmount');
  const amount = parseFloat(amtInput?.value || 0);
  const btn = document.getElementById('btnSubmitDeposit');
  
  if (isNaN(amount) || amount < MIN_DEPOSIT_USDT) {
    showWalletToast(`Minimum deposit is ${MIN_DEPOSIT_USDT} USDT.`, 'error');
    if (amtInput) amtInput.focus();
    return;
  }
  
  const client = window.BitchainAuth && window.BitchainAuth.getSupabase ? window.BitchainAuth.getSupabase() : null;
  if (!client) {
    showWalletToast('Database connection error. Please try again.', 'error');
    return;
  }
  
  btn.disabled = true;
  btn.innerHTML = '<span class="wallet-spinner"></span> Submitting...';
  
  try {
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr || !user) throw new Error('You must be logged in to deposit.');
    
    let proofUrl = null;
    
    // Upload screenshot if provided (optional)
    if (selectedProofFile) {
      try {
        const fileExt = selectedProofFile.name.split('.').pop();
        const filePath = `${user.id}/deposit_${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await client.storage.from('deposits').upload(filePath, selectedProofFile, {
          cacheControl: '3600',
          upsert: true
        });
        
        if (!uploadErr) {
          const { data: urlData } = client.storage.from('deposits').getPublicUrl(filePath);
          proofUrl = urlData?.publicUrl || null;
        }
      } catch (storageErr) {
        console.warn('Storage upload note (screenshot optional):', storageErr);
      }
    }
    
    const txId = 'DEP' + Math.floor(100000 + Math.random() * 900000);
    
    const { error: insertErr } = await client.from('deposits').insert({
      user_id: user.id,
      amount: amount,
      payment_method: 'USDT (BEP20)',
      transaction_id: txId,
      proof_url: proofUrl,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    if (insertErr) throw insertErr;
    
    // Reset form
    if (amtInput) amtInput.value = '';
    removeProofFile();
    calcDepositReceive();
    
    showWalletToast('🎉 Deposit submitted! Pending admin review.', 'success');
    loadUserWalletHistory();
    
    setTimeout(() => {
      closeDepositModal();
    }, 1800);
    
  } catch (err) {
    console.error('Deposit submit error:', err);
    showWalletToast(err.message || 'Failed to submit deposit.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Submit Deposit';
  }
}

/**
 * Submit Withdrawal Request to Supabase
 */
async function submitWithdraw() {
  const amtInput = document.getElementById('withdrawAmount');
  const addrInput = document.getElementById('withdrawAddress');
  const amount = parseFloat(amtInput?.value || 0);
  const destination = (addrInput?.value || '').trim();
  const btn = document.getElementById('btnSubmitWithdraw');
  
  if (isNaN(amount) || amount < MIN_WITHDRAW_USDT) {
    showWalletToast(`Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT.`, 'error');
    if (amtInput) amtInput.focus();
    return;
  }
  
  if (!destination || destination.length < 10) {
    showWalletToast('Please enter a valid BEP-20 wallet address.', 'error');
    if (addrInput) addrInput.focus();
    return;
  }
  
  const client = window.BitchainAuth && window.BitchainAuth.getSupabase ? window.BitchainAuth.getSupabase() : null;
  if (!client) {
    showWalletToast('Database connection error. Please try again.', 'error');
    return;
  }
  
  btn.disabled = true;
  btn.innerHTML = '<span class="wallet-spinner"></span> Submitting...';
  
  try {
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr || !user) throw new Error('You must be logged in to withdraw.');
    
    // Check available balance from profiles
    const { data: profile, error: profErr } = await client.from('profiles').select('available_balance').eq('id', user.id).single();
    if (profErr) throw profErr;
    
    const available = parseFloat(profile?.available_balance || 0);
    if (available < amount) {
      throw new Error(`Insufficient balance. You have ${available.toFixed(2)} USDT.`);
    }
    
    const { error: insertErr } = await client.from('withdrawals').insert({
      user_id: user.id,
      amount: amount,
      withdrawal_method: 'USDT (BEP20)',
      destination: destination,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    if (insertErr) throw insertErr;
    
    // Reset form
    if (amtInput) amtInput.value = '';
    if (addrInput) addrInput.value = '';
    calcWithdrawReceive();
    
    showWalletToast('🎉 Withdrawal requested! Pending admin approval.', 'success');
    loadUserWalletHistory();
    
    setTimeout(() => {
      closeWithdrawModal();
    }, 1800);
    
  } catch (err) {
    console.error('Withdraw submit error:', err);
    showWalletToast(err.message || 'Failed to submit withdrawal.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Submit Withdrawal <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:6px;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  }
}

/**
 * Load Deposit & Withdrawal History for the Current User
 */
async function loadUserWalletHistory() {
  const client = window.BitchainAuth && window.BitchainAuth.getSupabase ? window.BitchainAuth.getSupabase() : null;
  if (!client) return;
  
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    
    // Sync available balance in dashboard wallet card & modal
    const { data: profile } = await client.from('profiles').select('available_balance').eq('id', user.id).single();
    if (profile) {
      const bal = parseFloat(profile.available_balance || 0).toFixed(2);
      const mainBalEl = document.getElementById('walletMainBalance');
      const usdValEl = document.getElementById('walletUsdValue');
      const withBalEl = document.getElementById('withdrawAvailableBal');
      const withCardBalEl = document.getElementById('withdrawCardAvailableBal');
      
      if (mainBalEl) mainBalEl.textContent = bal;
      if (usdValEl) usdValEl.textContent = `≈ $${bal}`;
      if (withBalEl) withBalEl.textContent = `${bal} USDT`;
      if (withCardBalEl) withCardBalEl.textContent = `${bal} USDT`;
    }
    
    // Load recent deposits
    const { data: deposits } = await client.from('deposits').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
    renderHistoryList('userDepositsList', deposits, 'deposit');
    
    // Load recent withdrawals
    const { data: withdrawals } = await client.from('withdrawals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
    renderHistoryList('userWithdrawalsList', withdrawals, 'withdraw');
    
  } catch (err) {
    console.warn('Wallet history fetch warning:', err);
  }
}

function renderHistoryList(containerId, list, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (!list || list.length === 0) {
    container.innerHTML = `<div style="font-size:0.8rem;text-align:center;color:rgba(255,255,255,0.4);padding:14px;">No ${type} history yet</div>`;
    return;
  }
  
  let html = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">';
  list.forEach(item => {
    const amt = parseFloat(item.amount || 0).toFixed(2);
    const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const status = item.status || 'pending';
    const statusColor = status === 'approved' || status === 'completed' ? '#00f5d4' : (status === 'rejected' ? '#e63946' : '#ffd166');
    const statusBg = status === 'approved' || status === 'completed' ? 'rgba(0,245,212,0.15)' : (status === 'rejected' ? 'rgba(230,57,70,0.15)' : 'rgba(255,209,102,0.15)');
    
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);padding:10px 14px;border-radius:10px;font-size:0.82rem;">
        <div>
          <div style="font-weight:700;color:#fff;">+${amt} USDT</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-top:2px;">${date}</div>
        </div>
        <span style="background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;text-transform:capitalize;">
          ${status}
        </span>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Modal Open / Close Helpers
 */
function openDepositModal() {
  const wrap = document.getElementById('depositModalWrap');
  if (wrap) {
    wrap.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    calcDepositReceive();
    loadUserWalletHistory();
  }
}

function closeDepositModal() {
  const wrap = document.getElementById('depositModalWrap');
  if (wrap) {
    wrap.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function openWithdrawModal() {
  const wrap = document.getElementById('withdrawModalWrap');
  if (wrap) {
    wrap.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    calcWithdrawReceive();
    loadUserWalletHistory();
  }
}

function closeWithdrawModal() {
  const wrap = document.getElementById('withdrawModalWrap');
  if (wrap) {
    wrap.style.display = 'none';
    document.body.style.overflow = '';
  }
}

/**
 * Wallet Toast Helper
 */
function showWalletToast(msg, type = 'success') {
  let toast = document.getElementById('walletActionToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'walletActionToast';
    toast.style.cssText = `
      position:fixed; bottom:30px; left:50%; transform:translateX(-50%);
      padding:14px 28px; border-radius:50px; font-size:0.88rem; font-weight:700;
      z-index:9999999; pointer-events:none; transition:all 0.3s ease;
      box-shadow:0 6px 30px rgba(0,0,0,0.6); white-space:nowrap; text-align:center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = type === 'success' ? 'linear-gradient(135deg,#06d6a0,#07c984)' : (type === 'warning' ? 'linear-gradient(135deg,#ffb703,#fb8500)' : 'linear-gradient(135deg,#e63946,#c1121f)');
  toast.style.color = '#fff';
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}

// Global Exports
window.WalletModule = {
  copyDepositAddress,
  calcDepositReceive,
  calcWithdrawReceive,
  handleProofSelect,
  removeProofFile,
  submitDeposit,
  submitWithdraw,
  loadUserWalletHistory,
  openDepositModal,
  closeDepositModal,
  openWithdrawModal,
  closeWithdrawModal,
  showWalletToast
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadUserWalletHistory, 1200);
});
