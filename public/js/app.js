/**
 * RideLink Main Application Script
 * View routing, navigation bar, auth modals, and global toast notifications
 */

// Global State
window.RideLink = {
  currentView: 'marketplace',
  currentUser: null,
  activeModal: null,
  selectedVehicle: null,
  activeBooking: null
};

// 1. Toast Notification Manager
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-check-circle';
  if (type === 'error') icon = 'fa-exclamation-circle';
  if (type === 'warning') icon = 'fa-exclamation-triangle';

  toast.innerHTML = `
    <i class="fas ${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
window.showToast = showToast;

// 2. Modal Controls
function openModal(modalId) {
  closeModal();
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    window.RideLink.activeModal = modalId;
  }
}
window.openModal = openModal;

function closeModal() {
  const activeModals = document.querySelectorAll('.modal-overlay.active');
  activeModals.forEach(m => m.classList.remove('active'));
  document.body.style.overflow = '';
  window.RideLink.activeModal = null;
}
window.closeModal = closeModal;

// 3. View Switcher & Routing
function navigateTo(viewId) {
  // Page access guards for authenticated views
  const protectedViews = ['customer-dash', 'owner-dash', 'admin-dash'];
  if (protectedViews.includes(viewId)) {
    const user = api.getUser();
    if (!user) {
      showToast('Please sign in to access your dashboard.', 'warning');
      openModal('modal-auth');
      return;
    }
    if (viewId === 'owner-dash' && user.role !== 'owner' && user.role !== 'admin') {
      showToast('Host Portal is reserved for vehicle owners.', 'warning');
      return;
    }
    if (viewId === 'admin-dash' && user.role !== 'admin') {
      showToast('Administrator privileges required.', 'error');
      return;
    }
  }

  const views = document.querySelectorAll('.app-view');
  views.forEach(v => v.classList.remove('active-view'));

  const targetView = document.getElementById(`view-${viewId}`);
  if (targetView) {
    targetView.classList.add('active-view');
    window.RideLink.currentView = viewId;
  }

  // Update Nav Links
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.dataset.view === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update Mobile Nav
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    if (item.dataset.view === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Trigger view specific loaders
  if (viewId === 'marketplace' && window.Marketplace) {
    window.Marketplace.loadVehicles();
  } else if (viewId === 'customer-dash' && window.CustomerDash) {
    window.CustomerDash.loadData();
  } else if (viewId === 'owner-dash' && window.OwnerDash) {
    window.OwnerDash.loadData();
  } else if (viewId === 'admin-dash' && window.AdminDash) {
    window.AdminDash.loadData();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.navigateTo = navigateTo;

// 4. Update Navigation Bar based on Auth State
function updateNavUI(user) {
  const authNavGuest = document.getElementById('nav-auth-guest');
  const authNavUser = document.getElementById('nav-auth-user');
  const navAvatar = document.getElementById('nav-user-avatar');
  const navName = document.getElementById('nav-user-name');
  const navRole = document.getElementById('nav-user-role');
  const navDashLink = document.getElementById('nav-dynamic-dash');
  const mobileNavDash = document.getElementById('mobile-nav-dash');

  if (user) {
    if (authNavGuest) authNavGuest.style.display = 'none';
    if (authNavUser) authNavUser.style.display = 'flex';
    if (navAvatar) navAvatar.src = user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80';
    if (navName) navName.textContent = user.name.split(' ')[0];
    if (navRole) navRole.textContent = user.role.toUpperCase();

    // Adjust dashboard links based on role
    if (navDashLink) {
      navDashLink.style.display = 'flex';
      if (user.role === 'customer') {
        navDashLink.dataset.view = 'customer-dash';
        navDashLink.innerHTML = `<i class="fas fa-ticket-alt"></i> My Trips`;
      } else if (user.role === 'owner') {
        navDashLink.dataset.view = 'owner-dash';
        navDashLink.innerHTML = `<i class="fas fa-car"></i> Host Portal`;
      } else if (user.role === 'admin') {
        navDashLink.dataset.view = 'admin-dash';
        navDashLink.innerHTML = `<i class="fas fa-shield-alt"></i> Admin Desk`;
      }
    }

    if (mobileNavDash) {
      if (user.role === 'customer') {
        mobileNavDash.dataset.view = 'customer-dash';
        mobileNavDash.querySelector('span').textContent = 'My Trips';
      } else if (user.role === 'owner') {
        mobileNavDash.dataset.view = 'owner-dash';
        mobileNavDash.querySelector('span').textContent = 'Host';
      } else if (user.role === 'admin') {
        mobileNavDash.dataset.view = 'admin-dash';
        mobileNavDash.querySelector('span').textContent = 'Admin';
      }
    }
  } else {
    if (authNavGuest) authNavGuest.style.display = 'flex';
    if (authNavUser) authNavUser.style.display = 'none';
    if (navDashLink) navDashLink.style.display = 'none';
  }
}

// 5. Auth Actions (Demo Login, Logout)
async function doDemoLogin(role) {
  try {
    const res = await api.post('/auth/demo-login', { role });
    api.setSession(res.token, res.user);
    closeModal();
    showToast(`Switched to demo ${res.user.role}: ${res.user.name}!`);

    if (res.user.role === 'customer') navigateTo('marketplace');
    if (res.user.role === 'owner') navigateTo('owner-dash');
    if (res.user.role === 'admin') navigateTo('admin-dash');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.doDemoLogin = doDemoLogin;

// Delegate to AuthUI (defined in firebase-auth.js)
async function handleLoginSubmit(e) {
  if (window.AuthUI) return AuthUI.handleLogin(e);
  e.preventDefault();
  const email = (document.getElementById('login-email').value || '').trim();
  const password = document.getElementById('login-password').value;
  try {
    const res = await api.post('/auth/login', { email, password });
    api.setSession(res.token, res.user);
    closeModal();
    showToast(res.message);
    if (res.user.role === 'owner') navigateTo('owner-dash');
    else if (res.user.role === 'admin') navigateTo('admin-dash');
    else navigateTo('marketplace');
  } catch (err) { showToast(err.message, 'error'); }
}

async function handleRegisterSubmit(e) {
  if (window.AuthUI) return AuthUI.handleRegister(e);
  e.preventDefault();
  const name = (document.getElementById('reg-name').value || '').trim();
  const email = (document.getElementById('reg-email').value || '').trim();
  const phone = (document.getElementById('reg-phone').value || '').trim();
  const password = document.getElementById('reg-password').value;
  const role = document.querySelector('input[name="reg-role"]:checked')?.value || 'customer';
  const termsChecked = document.getElementById('reg-terms-check')?.checked;

  if (!termsChecked) {
    showToast('You must read and agree to the Terms and Conditions and Privacy Policy.', 'warning');
    const errEl = document.getElementById('reg-terms-error');
    if (errEl) { errEl.textContent = 'You must read and agree to the Terms and Conditions and Privacy Policy.'; errEl.style.display = 'block'; }
    return;
  }

  try {
    const res = await api.post('/auth/register', { name, email, phone, password, role, agree_terms: true });
    api.setSession(res.token, res.user);
    closeModal();
    showToast(`Welcome, ${res.user.name}!`);
    if (res.user.role === 'owner') navigateTo('owner-dash');
    else navigateTo('marketplace');
  } catch (err) { showToast(err.message, 'error'); }
}

function handleLogout() {
  if (window.AuthUI) { AuthUI.handleLogout(); return; }
  api.clearSession();
  showToast('Logged out successfully.');
  navigateTo('marketplace');
}
window.handleLogout = handleLogout;

// Protected page guard — redirects to auth modal if not logged in
function requireAuth(callback) {
  const user = api.getUser();
  if (!user) {
    showToast('Please sign in to access this feature.', 'warning');
    openModal('modal-auth');
    return false;
  }
  if (callback) callback(user);
  return true;
}
window.requireAuth = requireAuth;

// 6. Global DOM Listeners & Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Listen for auth changes
  window.addEventListener('ridelink:auth-change', (e) => {
    window.RideLink.currentUser = e.detail.user;
    updateNavUI(e.detail.user);
  });

  // Restore session from localStorage (no auto demo-login)
  const initialUser = api.getUser();
  if (initialUser) {
    window.RideLink.currentUser = initialUser;
    updateNavUI(initialUser);
  }

  // Navigation Links click binding
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) navigateTo(view);
    });
  });

  // Modal close buttons & backdrop click
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.RideLink.activeModal) {
      closeModal();
    }
  });

  // Auth Forms — delegate to AuthUI
  const loginForm = document.getElementById('form-login');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  const regForm = document.getElementById('form-register');
  if (regForm) regForm.addEventListener('submit', handleRegisterSubmit);

  // Forgot Password Forms
  const forgotForm = document.getElementById('form-forgot-password');
  if (forgotForm) forgotForm.addEventListener('submit', (e) => {
    if (window.AuthUI) AuthUI.handleForgotPassword(e);
  });

  const resetForm = document.getElementById('form-reset-password');
  if (resetForm) resetForm.addEventListener('submit', (e) => {
    if (window.AuthUI) AuthUI.handleResetPassword(e);
  });

  // Google Sign-In buttons
  document.querySelectorAll('[data-action="google-signin"]').forEach(btn => {
    btn.addEventListener('click', () => {
      let role = btn.dataset.role || 'customer';
      const roleRadio = document.querySelector('input[name="reg-role"]:checked');
      if (roleRadio && btn.closest('#tab-register')) {
        role = roleRadio.value;
      }
      if (window.AuthUI) AuthUI.handleGoogleSignIn(role);
    });
  });

  // Tab switching in Auth modal
  document.querySelectorAll('.auth-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      if (window.AuthUI) {
        AuthUI.switchTab(targetId);
      } else {
        document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.auth-tab-content').forEach(c => {
          c.classList.remove('active');
          c.style.display = 'none';
        });
        btn.classList.add('active');
        const target = document.getElementById(targetId);
        if (target) {
          target.classList.add('active');
          target.style.display = 'block';
        }
      }
    });
  });

  // "My Bookings" protected nav guard
  document.querySelectorAll('[data-requires-auth]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (!api.getUser()) {
        e.stopPropagation();
        showToast('Please sign in to continue.', 'warning');
        openModal('modal-auth');
      }
    });
  });
});
