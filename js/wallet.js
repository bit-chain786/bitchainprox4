/* ==========================================================================
   WALLET MODULE (USDT BEP-20)
   ========================================================================== */

let walletSettings = {
  bep20_deposit_address: "TDsJx7GfR3mbX9jYkLBQwz6h1Kp8uN8z3c",
  min_deposit: 10.00,
  min_withdrawal: 10.00,
  withdrawal_fee: 1.00
};

let uploadedProofFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (window.location.pathname.includes('dashboard.html')) {
    await fetchWalletSettings();
    updateWalletUI();
    loadDepositHistory();
    loadWithdrawalHistory();
  }
});

async function fetchWalletSettings() {
  const sb = window.BitchainAuth?.getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'wallet_settings').maybeSingle();
    if (data && data.value) {
      walletSettings = { ...walletSettings, ...data.value };
    }
  } catch (e) {
    console.warn('Failed to load wallet settings, using defaults.', e);
  }
}

function openDepositModal() {
  const el = document.getElementById('depositModalWrap');
  if (el) el.style.display = 'flex';
}

function openWithdrawModal() {
  const el = document.getElementById('withdrawModalWrap');
  if (el) el.style.display = 'flex';
}

function updateWalletUI() {
  const depositMinNote = document.getElementById('depositMinNote');
  if (depositMinNote) depositMinNote.textContent = `Minimum Deposit: ${walletSettings.min_deposit.toFixed(2)} USDTBEP20`;

  const depositAddress = document.getElementById('bep20DepositAddress');
  if (depositAddress) depositAddress.value = walletSettings.bep20_deposit_address;

  const feeVal = document.getElementById('withdrawFeeVal');
  if (feeVal) feeVal.textContent = `${walletSettings.withdrawal_fee.toFixed(2)} USDTBEP20`;

  // Update wallet main balance if user profile exists
  const pStr = localStorage.getItem('bitchain_user_profile');
  if (pStr) {
    const p = JSON.parse(pStr);
    const bal = parseFloat(p.available_balance || 0);
    const mainBal = document.getElementById('walletMainBalance');
    if (mainBal) mainBal.textContent = bal.toFixed(2);
    
    const usdVal = document.getElementById('walletUsdValue');
    if (usdVal) usdVal.textContent = `≈ $${bal.toFixed(2)}`;

    const wdBal = document.getElementById('withdrawAvailableBal');
    if (wdBal) wdBal.textContent = `${bal.toFixed(2)} USDTBEP20`;
  }
}

function calcDepositReceive() {
  const amtInput = document.getElementById('depositAmount');
  const rcvVal = document.getElementById('depositReceiveVal');
  if (!amtInput || !rcvVal) return;
  const amt = parseFloat(amtInput.value) || 0;
  rcvVal.textContent = `${amt.toFixed(2)} USDTBEP20`;
}

function calcWithdrawReceive() {
  const amtInput = document.getElementById('withdrawAmount');
  const rcvVal = document.getElementById('withdrawReceiveVal');
  if (!amtInput || !rcvVal) return;
  const amt = parseFloat(amtInput.value) || 0;
  let net = amt - walletSettings.withdrawal_fee;
  if (net < 0) net = 0;
  rcvVal.textContent = `${net.toFixed(2)} USDTBEP20`;
}

function copyDepositAddress() {
  const addrInput = document.getElementById('bep20DepositAddress');
  if (!addrInput) return;
  addrInput.select();
  document.execCommand('copy');
  
  // Show toast or simple alert
  if (window.toast) {
    toast('Address copied to clipboard!', 'success');
  } else {
    alert('Address copied to clipboard!');
  }
}

function handleProofSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validate size
  if (file.size > 5 * 1024 * 1024) {
    if (window.toast) toast('File size exceeds 5MB limit.', 'error');
    else alert('File size exceeds 5MB limit.');
    return;
  }

  uploadedProofFile = file;
  const nameEl = document.getElementById('proofFileName');
  if (nameEl) {
    nameEl.textContent = file.name;
    nameEl.style.display = 'block';
  }
}

// Allow drag and drop
const dropZone = document.getElementById('proofDropZone');
if (dropZone) {
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#c77dff';
    dropZone.style.background = 'rgba(157, 78, 221, 0.08)';
  });
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(157, 78, 221, 0.4)';
    dropZone.style.background = 'rgba(157, 78, 221, 0.03)';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(157, 78, 221, 0.4)';
    dropZone.style.background = 'rgba(157, 78, 221, 0.03)';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      document.getElementById('proofFileInput').files = e.dataTransfer.files;
      handleProofSelect({ target: { files: e.dataTransfer.files } });
    }
  });
}

async function uploadProofToStorage(file) {
  const sb = window.BitchainAuth?.getSupabase();
  if (!sb) throw new Error('Supabase not initialized');

  const user = await window.BitchainAuth.getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const fileExt = file.name.split('.').pop();
  const fileName = `${user.id}/${Date.now()}.${fileExt}`;

  // Try the intended bucket first.
  try {
    const { data, error } = await sb.storage.from('deposit-proofs').upload(fileName, file);
    if (error) throw error;
    const { data: publicData } = sb.storage.from('deposit-proofs').getPublicUrl(fileName);
    return publicData.publicUrl;
  } catch (e) {
    // If bucket missing, fall back to the default "public" bucket.
    if (e.message && e.message.toLowerCase().includes('bucket not found')) {
      const msg = "Bucket 'deposit-proofs' not found. Uploading to default 'public' bucket instead.";
      if (window.toast) toast(msg, 'warning'); else alert(msg);
      const { data, error } = await sb.storage.from('public').upload(fileName, file);
      if (error) throw error;
      const { data: publicData } = sb.storage.from('public').getPublicUrl(fileName);
      return publicData.publicUrl;
    }
    // Re‑throw other errors.
    throw e;
  }
}

async function submitDeposit() {
  const amtInput = document.getElementById('depositAmount');
  const amt = parseFloat(amtInput.value);

  if (isNaN(amt) || amt < walletSettings.min_deposit) {
    if (window.toast) toast(`Minimum deposit is ${walletSettings.min_deposit} USDT.`, 'error');
    else alert(`Minimum deposit is ${walletSettings.min_deposit} USDT.`);
    return;
  }

  if (!uploadedProofFile) {
    if (window.toast) toast('Please upload a payment screenshot.', 'error');
    else alert('Please upload a payment screenshot.');
    return;
  }

  const btn = document.getElementById('btnSubmitDeposit');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const sb = window.BitchainAuth?.getSupabase();
    const user = await window.BitchainAuth.getCurrentUser();
    if (!user) throw new Error('Not authenticated');

    const proofUrl = await uploadProofToStorage(uploadedProofFile);

    const { error } = await sb.from('deposits').insert({
      user_id: user.id,
      amount: amt,
      payment_method: 'USDTBEP20',
      proof_url: proofUrl,
      status: 'pending'
    });

    if (error) throw error;

    if (window.toast) toast('Deposit request submitted successfully.', 'success');
    else alert('Deposit request submitted successfully.');
    
    // Reset form
    amtInput.value = '';
    uploadedProofFile = null;
    const nameEl = document.getElementById('proofFileName');
    if (nameEl) {
      nameEl.textContent = '';
      nameEl.style.display = 'none';
    }
    calcDepositReceive();
    loadDepositHistory();
  } catch (e) {
    console.error(e);
    if (window.toast) toast(e.message || 'Deposit submission failed.', 'error');
    else alert(e.message || 'Deposit submission failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'I Have Made a Deposit';
  }
}

async function submitWithdraw() {
  const amtInput = document.getElementById('withdrawAmount');
  const amt = parseFloat(amtInput.value);
  const addrInput = document.getElementById('withdrawAddress');
  const address = addrInput.value.trim();

  if (isNaN(amt) || amt < walletSettings.min_withdrawal) {
    if (window.toast) toast(`Minimum withdrawal is ${walletSettings.min_withdrawal} USDT.`, 'error');
    else alert(`Minimum withdrawal is ${walletSettings.min_withdrawal} USDT.`);
    return;
  }

  if (!address) {
    if (window.toast) toast('Please enter a BEP-20 wallet address.', 'error');
    else alert('Please enter a BEP-20 wallet address.');
    return;
  }

  const pStr = localStorage.getItem('bitchain_user_profile');
  if (!pStr) return;
  const p = JSON.parse(pStr);
  const bal = parseFloat(p.available_balance || 0);

  if (amt > bal) {
    if (window.toast) toast('Insufficient Balance.', 'error');
    else alert('Insufficient Balance.');
    return;
  }

  const btn = document.getElementById('btnSubmitWithdraw');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const sb = window.BitchainAuth?.getSupabase();
    const user = await window.BitchainAuth.getCurrentUser();
    if (!user) throw new Error('Not authenticated');

    // Create withdrawal - status pending.
    // Admin handles actual balance deduction when processing.
    const { error } = await sb.from('withdrawals').insert({
      user_id: user.id,
      amount: amt,
      withdrawal_method: 'USDTBEP20',
      destination: address,
      status: 'pending'
    });

    if (error) throw error;

    if (window.toast) toast('Withdrawal request submitted successfully.', 'success');
    else alert('Withdrawal request submitted successfully.');
    
    // Reset form
    amtInput.value = '';
    addrInput.value = '';
    calcWithdrawReceive();
    loadWithdrawalHistory();
  } catch (e) {
    console.error(e);
    if (window.toast) toast(e.message || 'Withdrawal submission failed.', 'error');
    else alert(e.message || 'Withdrawal submission failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Withdrawal';
  }
}

async function loadDepositHistory() {
  const sb = window.BitchainAuth?.getSupabase();
  const user = await window.BitchainAuth?.getCurrentUser();
  if (!sb || !user) return;

  const list = document.getElementById('userDepositsList');
  if (!list) return;

  const { data, error } = await sb.from('deposits').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
  
  if (error || !data || data.length === 0) {
    list.innerHTML = '<div class="empty-state-text" style="font-size:0.8rem;text-align:center;color:var(--text-muted);">No deposits yet</div>';
    return;
  }

  list.innerHTML = data.map(d => `
    <div class="wallet-history-item">
      <div class="history-item-left">
        <span class="history-item-amount">$${parseFloat(d.amount).toFixed(2)} USDT</span>
        <span class="history-item-date">${new Date(d.created_at).toLocaleDateString()}</span>
      </div>
      <div>
        <span class="badge badge-${d.status}" style="font-size:0.7rem;">${d.status}</span>
      </div>
    </div>
  `).join('');
}

async function loadWithdrawalHistory() {
  const sb = window.BitchainAuth?.getSupabase();
  const user = await window.BitchainAuth?.getCurrentUser();
  if (!sb || !user) return;

  const list = document.getElementById('userWithdrawalsList');
  if (!list) return;

  const { data, error } = await sb.from('withdrawals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
  
  if (error || !data || data.length === 0) {
    list.innerHTML = '<div class="empty-state-text" style="font-size:0.8rem;text-align:center;color:var(--text-muted);">No withdrawal requests yet</div>';
    return;
  }

  list.innerHTML = data.map(w => `
    <div class="wallet-history-item">
      <div class="history-item-left">
        <span class="history-item-amount">$${parseFloat(w.amount).toFixed(2)} USDT</span>
        <span class="history-item-date">${new Date(w.created_at).toLocaleDateString()}</span>
      </div>
      <div>
        <span class="badge badge-${w.status}" style="font-size:0.7rem;">${w.status}</span>
      </div>
    </div>
  `).join('');
}
