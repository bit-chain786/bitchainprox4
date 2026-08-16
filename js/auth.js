/* ==========================================================================
   BITCHAIN PRO X — AUTHENTICATION INTERACTION ENGINE
   Handles UI validation, password visibility toggling, country code selection,
   referral link auto-detection, Supabase integration calls, and alerts.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initPasswordEyeToggles();
  initCountrySelector();
  initReferralLinkDetection();
  initSignUpForm();
  initSignInForm();
  initForgotPasswordForm();
  initResetPasswordForm();
  initAuthNavigationState();
});

/* ==========================================================================
   1. PASSWORD SHOW/HIDE EYE BUTTON TOGGLE
   ========================================================================== */
function initPasswordEyeToggles() {
  const eyeButtons = document.querySelectorAll('.btn-toggle-eye');

  eyeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.getAttribute('type') === 'password';
      
      if (isPassword) {
        input.setAttribute('type', 'text');
        btn.setAttribute('aria-label', 'Hide password');
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        `;
      } else {
        input.setAttribute('type', 'password');
        btn.setAttribute('aria-label', 'Show password');
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        `;
      }
    });
  });
}

/* ==========================================================================
   2. COUNTRY CODE SELECTOR DROPDOWN
   ========================================================================== */
function initCountrySelector() {
  const btn = document.getElementById('countrySelectBtn');
  const popover = document.getElementById('countryListPopover');
  const flagDisplay = document.getElementById('selectedFlag');
  const codeDisplay = document.getElementById('selectedDialCode');
  const hiddenDialInput = document.getElementById('hiddenDialCode');

  if (!btn || !popover) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== btn) {
      popover.classList.remove('active');
    }
  });

  const options = popover.querySelectorAll('.country-opt-item');
  options.forEach(opt => {
    opt.addEventListener('click', () => {
      const flag = opt.getAttribute('data-flag');
      const code = opt.getAttribute('data-code');

      if (flagDisplay) flagDisplay.textContent = flag;
      if (codeDisplay) codeDisplay.textContent = code;
      if (hiddenDialInput) hiddenDialInput.value = code;

      popover.classList.remove('active');
    });
  });
}

/* ==========================================================================
   3. REFERRAL LINK AUTO-DETECTION (?ref=USERNAME)
   ========================================================================== */
function initReferralLinkDetection() {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref') || urlParams.get('sponsor');
  const sponsorInput = document.getElementById('sponsor_username');
  const refBadgeWrap = document.getElementById('referralBadgeWrap');

  if (refCode && sponsorInput) {
    const cleanRef = refCode.trim();
    sponsorInput.value = cleanRef;
    
    if (refBadgeWrap) {
      refBadgeWrap.innerHTML = `
        <div class="referral-applied-badge">
          ✦ Referral Sponsor Applied: <strong>@${cleanRef}</strong>
        </div>
      `;
    }
  }
}

/* ==========================================================================
   4. SIGN UP FORM VALIDATION & SUPABASE SUBMISSION
   ========================================================================== */
function initSignUpForm() {
  const form = document.getElementById('signUpForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const fullName = document.getElementById('full_name').value.trim();
    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const phoneNum = document.getElementById('phone_number').value.trim();
    const dialCode = document.getElementById('hiddenDialCode') ? document.getElementById('hiddenDialCode').value : '+92';
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm_password').value;
    const sponsorUsername = document.getElementById('sponsor_username').value.trim();
    const termsCheckbox = document.getElementById('terms_agree');
    const submitBtn = document.getElementById('btnSignUpSubmit');

    let hasError = false;

    // 1. Full Name Validation
    if (!fullName) {
      showFieldError('full_name', 'Full name is required');
      hasError = true;
    }

    // 2. Username Validation
    if (!username) {
      showFieldError('username', 'Choose a username');
      hasError = true;
    } else if (username.length < 3) {
      showFieldError('username', 'Username must be at least 3 characters');
      hasError = true;
    } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      showFieldError('username', 'Only letters, numbers, and underscores allowed');
      hasError = true;
    }

    // 3. Email Validation
    if (!email) {
      showFieldError('email', 'Email address is required');
      hasError = true;
    } else if (!validateEmail(email)) {
      showFieldError('email', 'Please enter a valid email address');
      hasError = true;
    }

    // 4. Phone Number Validation
    if (!phoneNum) {
      showFieldError('phone_number', 'Phone number is required');
      hasError = true;
    }

    // 5. Password Validation
    if (!password) {
      showFieldError('password', 'Password is required');
      hasError = true;
    } else if (password.length < 6) {
      showFieldError('password', 'Password must be at least 6 characters');
      hasError = true;
    }

    // 6. Confirm Password Validation
    if (!confirmPassword) {
      showFieldError('confirm_password', 'Please confirm your password');
      hasError = true;
    } else if (password !== confirmPassword) {
      showFieldError('confirm_password', 'Passwords do not match');
      hasError = true;
    }

    // 7. Terms & Conditions Validation
    if (!termsCheckbox.checked) {
      showToastAlert('You must agree to the Terms & Conditions and Privacy Policy.', 'error');
      hasError = true;
    }

    if (hasError) return;

    // Set loading state on button
    setButtonLoading(submitBtn, true);

    try {
      const fullPhone = `${dialCode} ${phoneNum}`;
      
      if (!window.BitchainAuth || typeof window.BitchainAuth.signUpUser !== 'function') {
        throw new Error('Authentication module is initializing. Please refresh and try again.');
      }

      // Submit registration to Supabase
      const result = await window.BitchainAuth.signUpUser({
        fullName,
        username,
        email,
        phone: fullPhone,
        password,
        sponsorUsername
      });

      showToastAlert('🎉 Account created successfully! Redirecting...', 'success');

      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1200);

    } catch (err) {
      console.error('Registration Error:', err);
      showToastAlert(err.message || 'Failed to create account. Please try again.', 'error');
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ==========================================================================
   5. SIGN IN FORM VALIDATION & SUPABASE SUBMISSION
   ========================================================================== */
function initSignInForm() {
  const form = document.getElementById('signInForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const email = document.getElementById('signin_email').value.trim();
    const password = document.getElementById('signin_password').value;
    const submitBtn = document.getElementById('btnSignInSubmit');

    let hasError = false;

    if (!email) {
      showFieldError('signin_email', 'Enter your email address');
      hasError = true;
    } else if (!validateEmail(email)) {
      showFieldError('signin_email', 'Enter a valid email address');
      hasError = true;
    }

    if (!password) {
      showFieldError('signin_password', 'Enter your password');
      hasError = true;
    }

    if (hasError) return;

    setButtonLoading(submitBtn, true);

    try {
      if (!window.BitchainAuth || typeof window.BitchainAuth.signInUser !== 'function') {
        throw new Error('Authentication module is initializing. Please refresh and try again.');
      }

      await window.BitchainAuth.signInUser({ email, password });
      showToastAlert('⚡ Authentication successful! Accessing dashboard...', 'success');

      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);
    } catch (err) {
      console.error('Sign-in Error:', err);
      let userMsg = err.message || 'Invalid email or password.';
      if (userMsg.includes('Invalid login credentials')) {
        userMsg = 'Incorrect email or password. Please check your credentials.';
      }
      showToastAlert(userMsg, 'error');
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ==========================================================================
   6. FORGOT PASSWORD FORM & RESET REQUEST
   ========================================================================== */
function initForgotPasswordForm() {
  const form = document.getElementById('forgotPasswordForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const email = document.getElementById('forgot_email').value.trim();
    const submitBtn = document.getElementById('btnForgotSubmit');

    if (!email || !validateEmail(email)) {
      showFieldError('forgot_email', 'Please enter a valid email address');
      return;
    }

    setButtonLoading(submitBtn, true);

    try {
      await window.BitchainAuth.resetPasswordEmail(email);
      showToastAlert('📧 Password reset instructions have been sent to your email!', 'success');
      setButtonLoading(submitBtn, false);
    } catch (err) {
      console.error('Forgot Password Error:', err);
      showToastAlert(err.message || 'Failed to send reset link. Try again later.', 'error');
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ==========================================================================
   7. RESET PASSWORD FORM
   ========================================================================== */
function initResetPasswordForm() {
  const form = document.getElementById('resetPasswordForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const newPassword = document.getElementById('new_password').value;
    const confirmNewPassword = document.getElementById('confirm_new_password').value;
    const submitBtn = document.getElementById('btnResetSubmit');

    let hasError = false;

    if (!newPassword || newPassword.length < 6) {
      showFieldError('new_password', 'Password must be at least 6 characters');
      hasError = true;
    }

    if (newPassword !== confirmNewPassword) {
      showFieldError('confirm_new_password', 'Passwords do not match');
      hasError = true;
    }

    if (hasError) return;

    setButtonLoading(submitBtn, true);

    try {
      await window.BitchainAuth.updateUserPassword(newPassword);
      showToastAlert('✅ Password updated successfully! Please sign in.', 'success');

      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1500);
    } catch (err) {
      console.error('Reset Password Error:', err);
      showToastAlert(err.message || 'Failed to update password.', 'error');
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ==========================================================================
   8. AUTH STATE NAVBAR INTERACTION & AVATAR DROPDOWN
   ========================================================================== */
function initAuthNavigationState() {
  if (typeof window.BitchainAuth === 'undefined') return;

  window.BitchainAuth.onAuthStateChanged(async (event, session) => {
    updateNavUI(session);
  });

  // Initial check on load
  const client = window.BitchainAuth.getSupabase();
  if (client) {
    client.auth.getSession().then(({ data: { session } }) => {
      updateNavUI(session);
    });
  }
}

function updateNavUI(session) {
  const navActions = document.querySelector('.nav-actions');
  const mobActions = document.querySelector('.mobile-menu-actions');

  if (!navActions) return;

  const localProfileStr = localStorage.getItem('bitchain_user_profile');
  let profile = localProfileStr ? JSON.parse(localProfileStr) : null;

  if (session && session.user) {
    const displayName = profile?.full_name || session.user.email.split('@')[0];
    const username = profile?.username || session.user.email.split('@')[0];
    const initial = displayName.charAt(0).toUpperCase();

    // Determine if user is currently on the homepage (index.html or root '/')
    const isHomePage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');

    // Render context-aware menu items
    const menuLinksHtml = isHomePage ? `
          <a href="dashboard.html" class="dropdown-menu-item">
            <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Dashboard
          </a>
          <a href="settings.html" class="dropdown-menu-item">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
          </a>
          <a href="privacy.html" class="dropdown-menu-item">
            <svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Privacy Policy
          </a>
    ` : `
          <a href="my-team.html" class="dropdown-menu-item">
            <span style="font-size:1.15rem;line-height:1;margin-right:2px;">🏆</span>
            My Team
          </a>
          <a href="rewards.html" class="dropdown-menu-item">
            <span style="font-size:1.15rem;line-height:1;margin-right:2px;">🎁</span>
            Rewards
          </a>
          <a href="settings.html" class="dropdown-menu-item">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
          </a>
          <a href="privacy.html" class="dropdown-menu-item">
            <svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Privacy Policy
          </a>
    `;

    const userHtml = `
      <div class="nav-auth-user-wrap">
        <button class="btn-nav-avatar" id="btnNavAvatar" aria-label="User account menu" title="${displayName} (@${username})">
          <div class="avatar-circle-badge" id="navAvatarCircle">${initial}</div>
        </button>
        <div class="avatar-dropdown-menu" id="avatarDropdownMenu">
          <div class="dropdown-user-header">
            <div class="dropdown-full-name">${displayName}</div>
            <div class="dropdown-user-handle">@${username}</div>
          </div>
          ${menuLinksHtml}
          <div class="dropdown-menu-item logout-item" id="dropdownLogoutBtn">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Logout
          </div>
        </div>
      </div>
    `;

    navActions.innerHTML = userHtml;
    if (mobActions) mobActions.innerHTML = '';

    // Apply saved profile photo to navbar right away
    if (window.GlobalAvatar) window.GlobalAvatar.refresh();

    // Attach Avatar Dropdown toggle
    const avatarBtn = document.getElementById('btnNavAvatar');
    const dropdownMenu = document.getElementById('avatarDropdownMenu');
    const logoutBtn = document.getElementById('dropdownLogoutBtn');

    if (avatarBtn && dropdownMenu) {
      avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('active');
      });

      document.addEventListener('click', (e) => {
        if (!dropdownMenu.contains(e.target) && e.target !== avatarBtn) {
          dropdownMenu.classList.remove('active');
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        window.BitchainAuth.signOutUser();
      });
    }
  } else {
    // Logged Out UI
    const defaultNav = `
      <a href="login.html" class="btn-nav-signin">Sign In</a>
      <a href="register.html" class="btn-nav-register">Register</a>
    `;
    navActions.innerHTML = defaultNav;
    if (mobActions) mobActions.innerHTML = defaultNav;
  }
}

/* ==========================================================================
   HELPER UTILITIES
   ========================================================================== */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function showFieldError(fieldId, errorMsg) {
  const input = document.getElementById(fieldId);
  if (!input) return;

  input.classList.add('input-error');

  const container = input.closest('.form-field-group');
  if (container) {
    let errSpan = container.querySelector('.inline-error-msg');
    if (!errSpan) {
      errSpan = document.createElement('div');
      errSpan.className = 'inline-error-msg';
      container.appendChild(errSpan);
    }
    errSpan.innerHTML = `⚠️ ${errorMsg}`;
  }
}

function clearAllErrors() {
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  document.querySelectorAll('.inline-error-msg').forEach(el => el.remove());
  const toast = document.getElementById('authToastAlert');
  if (toast) toast.remove();
}

function showToastAlert(message, type = 'error') {
  const existing = document.getElementById('authToastAlert');
  if (existing) existing.remove();

  const container = document.querySelector('.card-header-group') || document.querySelector('.auth-form-card');
  if (!container) return;

  const toast = document.createElement('div');
  toast.id = 'authToastAlert';
  toast.className = `auth-toast-alert ${type}`;
  toast.innerHTML = `
    <span>${type === 'error' ? '🛑' : '✨'}</span>
    <div>${message}</div>
  `;

  container.insertAdjacentElement('afterend', toast);
}

function setButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}
