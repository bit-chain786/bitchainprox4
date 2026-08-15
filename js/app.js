/* ==========================================================================
   BITCHAINPROX — INTERACTIVE ENGINE (JS)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initParticleCanvas();
  initScrollAnimations();
  init3DTilt();
  initUpgradeJourney();
  initPackageModal();
  initAuthModals();
  initNavActiveHighlight();
  initHamburgerMenu();
  initFaqAccordion();
});

/* ==========================================================================
   1. AMBIENT PURPLE PARTICLE CANVAS
   ========================================================================== */
function initParticleCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const particleCount = Math.min(Math.floor(width / 18), 75);
  const particles = [];

  const colors = ['#C77DFF', '#E0AAFF', '#9D4EDD', '#5A189A', '#00F5D4'];

  class Particle {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * 2.5 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.4;
      this.speedY = (Math.random() - 0.5) * 0.4;
      this.color = colors[Math.floor(Math.random() * colors.length)];
      this.alpha = Math.random() * 0.6 + 0.2;
    }

    update() {
      this.x += this.speedX;
      this.y += this.speedY;

      if (this.x < 0 || this.x > width) this.speedX *= -1;
      if (this.y < 0 || this.y > height) this.speedY *= -1;
    }

    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.shadowBlur = 10;
      ctx.shadowColor = this.color;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 110) {
          ctx.save();
          ctx.globalAlpha = (1 - dist / 110) * 0.15;
          ctx.strokeStyle = '#C77DFF';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    particles.forEach(p => {
      p.update();
      p.draw();
    });

    requestAnimationFrame(animate);
  }

  animate();
}

/* ==========================================================================
   2. SCROLL REVEAL ANIMATIONS (IntersectionObserver)
   ========================================================================== */
function initScrollAnimations() {
  const elements = document.querySelectorAll('.fade-up-element');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.12 }
  );

  elements.forEach((el) => observer.observe(el));
}

/* ==========================================================================
   3. 3D CARD PERSPECTIVE TILT EFFECT
   ========================================================================== */
function init3DTilt() {
  const cards = document.querySelectorAll('.package-card, .benefit-card, .summary-card, .about-feature-box, .income-card, .benefit-glass-card, .why-card, .feat-card');

  cards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -6;
      const rotateY = ((x - centerX) / centerX) * 6;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6deg) scale(1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)`;
    });
  });
}

/* ==========================================================================
   4. UPGRADE JOURNEY TIMELINE INTERACTION
   ========================================================================== */
function initUpgradeJourney() {
  const nodes = document.querySelectorAll('.journey-node');
  const progressLine = document.querySelector('.journey-line-progress');
  const currentPlanVal = document.getElementById('currentPlanVal');
  const nextPlanVal = document.getElementById('nextPlanVal');
  const upgradeCostVal = document.getElementById('upgradeCostVal');
  const journeySection = document.querySelector('.upgrade-journey-section');

  const packageValues = [5, 10, 20, 40, 80, 160, 320, 640];
  let selectedIndex = 0;

  if (journeySection && progressLine) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          progressLine.style.width = '100%';
        }
      });
    }, { threshold: 0.3 });
    observer.observe(journeySection);
  }

  function updateJourney(index) {
    nodes.forEach((n, i) => {
      if (i <= index) {
        n.classList.add('active');
      } else {
        n.classList.remove('active');
      }
    });

    selectedIndex = index;
    const currentPrice = packageValues[index];
    const nextPrice = index < packageValues.length - 1 ? packageValues[index + 1] : packageValues[index];
    const diff = nextPrice - currentPrice;

    if (currentPlanVal) currentPlanVal.textContent = `$${currentPrice}`;
    if (nextPlanVal) nextPlanVal.textContent = `$${nextPrice}`;
    if (upgradeCostVal) upgradeCostVal.textContent = `$${diff}`;
  }

  nodes.forEach((node, idx) => {
    node.addEventListener('click', () => {
      updateJourney(idx);
    });
  });
}

/* ==========================================================================
   5. PACKAGE SELECTION MODAL
   ========================================================================== */
function initPackageModal() {
  const modalOverlay = document.getElementById('packageModal');
  const closeBtn = document.getElementById('closeModalBtn');
  const buttons = document.querySelectorAll('.package-card, .mob-pkg-row, .btn-sim-upgrade');
  const modalPackageName = document.getElementById('modalPackageName');
  const modalPrice = document.getElementById('modalPrice');
  const confirmBtn = document.getElementById('confirmActivateBtn');
  const modalFormState = document.getElementById('modalFormState');
  const modalSuccessState = document.getElementById('modalSuccessState');
  const currencyOpts = document.querySelectorAll('.currency-option');

  if (!modalOverlay) return;

  buttons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.package-card, .mob-pkg-row');
      let name = 'STARTER';
      let price = '$5';

      if (card) {
        name = card.getAttribute('data-package') || 'STARTER';
        price = card.getAttribute('data-price') || '$5';
      } else if (btn.classList.contains('btn-sim-upgrade')) {
        name = 'EXECUTIVE';
        price = '$320';
      }

      if (modalPackageName) modalPackageName.innerHTML = `${name} <span class="purple-gradient-text">PACKAGE</span>`;
      if (modalPrice) modalPrice.textContent = price;

      if (modalFormState) modalFormState.style.display = 'block';
      if (modalSuccessState) modalSuccessState.style.display = 'none';

      modalOverlay.classList.add('active');
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
    });
  }

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  });

  currencyOpts.forEach(opt => {
    opt.addEventListener('click', () => {
      currencyOpts.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      confirmBtn.innerHTML = '⚡ Processing Instant Activation...';
      confirmBtn.disabled = true;

      setTimeout(() => {
        confirmBtn.innerHTML = '⚡ Confirm Instant Activation';
        confirmBtn.disabled = false;
        if (modalFormState) modalFormState.style.display = 'none';
        if (modalSuccessState) modalSuccessState.style.display = 'block';
      }, 1200);
    });
  }
}

/* ==========================================================================
   6. AUTH MODALS — SIGN IN & REGISTER
   ========================================================================== */
function initAuthModals() {
  const signInModal    = document.getElementById('signInModal');
  const registerModal  = document.getElementById('registerModal');
  const openSignIn     = document.getElementById('openSignInBtn');
  const openRegister   = document.getElementById('openRegisterBtn');
  const closeSignIn    = document.getElementById('closeSignInBtn');
  const closeRegister  = document.getElementById('closeRegisterBtn');
  const switchToReg    = document.getElementById('switchToRegister');
  const switchToSign   = document.getElementById('switchToSignIn');

  function openModal(modal) {
    if (modal) modal.classList.add('active');
  }

  function closeModal(modal) {
    if (modal) modal.classList.remove('active');
  }

  const btnCtaJoinNow  = document.getElementById('btnCtaJoinNow');

  if (openSignIn)    openSignIn.addEventListener('click',   () => openModal(signInModal));
  if (openRegister)  openRegister.addEventListener('click', () => openModal(registerModal));
  if (btnCtaJoinNow) btnCtaJoinNow.addEventListener('click',() => openModal(registerModal));
  if (closeSignIn)   closeSignIn.addEventListener('click',  () => closeModal(signInModal));
  if (closeRegister) closeRegister.addEventListener('click',() => closeModal(registerModal));

  // Switch between modals
  if (switchToReg) {
    switchToReg.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(signInModal);
      openModal(registerModal);
    });
  }

  if (switchToSign) {
    switchToSign.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(registerModal);
      openModal(signInModal);
    });
  }

  // Close on backdrop click
  [signInModal, registerModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    }
  });
}

/* ==========================================================================
   7. NAV ACTIVE STATE HIGHLIGHT ON SCROLL (including Income section)
   ========================================================================== */
function initNavActiveHighlight() {
  const sections = [
    { id: 'about',    link: document.querySelector('.nav-links a[href="#about"]') },
    { id: 'packages', link: document.querySelector('.nav-links a[href="#packages"]') },
    { id: 'income',   link: document.querySelector('.nav-links a[href="#income"]') },
    { id: 'join',     link: document.querySelector('.nav-links a[href="#join"]') },
  ].filter(s => s.link && document.getElementById(s.id));

  if (!sections.length) return;

  function updateActive() {
    const scrollY = window.scrollY + window.innerHeight * 0.35;
    let currentId = null;

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el && el.offsetTop <= scrollY) {
        currentId = id;
      }
    });

    sections.forEach(({ id, link }) => {
      link.classList.toggle('active', id === currentId);
    });
  }

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
}

/* ==========================================================================
   HAMBURGER MOBILE MENU
   ========================================================================== */
function initHamburgerMenu() {
  const btn = document.getElementById('hamburgerBtn');
  const menu = document.getElementById('mobileMenu');
  if (!btn || !menu) return;

  // Toggle open/close
  btn.addEventListener('click', () => {
    btn.classList.toggle('open');
    menu.classList.toggle('open');
  });

  // Close menu when a nav link is tapped
  const links = menu.querySelectorAll('.mob-nav-link');
  links.forEach(link => {
    link.addEventListener('click', () => {
      btn.classList.remove('open');
      menu.classList.remove('open');
    });
  });

  // Wire mobile Sign In button to open Sign In modal
  const mobSignIn = document.getElementById('mobSignInBtn');
  if (mobSignIn) {
    mobSignIn.addEventListener('click', () => {
      btn.classList.remove('open');
      menu.classList.remove('open');
      document.getElementById('signInModal').classList.add('active');
    });
  }

  // Wire mobile Register button to open Register modal
  const mobRegister = document.getElementById('mobRegisterBtn');
  if (mobRegister) {
    mobRegister.addEventListener('click', () => {
      btn.classList.remove('open');
      menu.classList.remove('open');
      document.getElementById('registerModal').classList.add('active');
    });
  }
}

/* ==========================================================================
   FAQ ACCORDION
   ========================================================================== */
function initFaqAccordion() {
  const items = document.querySelectorAll('.faq-item');
  items.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      // Close all first
      items.forEach(i => i.classList.remove('open'));
      // Toggle clicked
      if (!isOpen) item.classList.add('open');
    });
  });
}
