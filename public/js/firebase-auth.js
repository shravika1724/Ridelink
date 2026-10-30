/**
 * RideLink Firebase Authentication Module
 * Handles Google Sign-In, email/password auth, form validation,
 * forgot password, and secure session management.
 *
 * SETUP: Replace firebaseConfig values with your project's config from
 * Firebase Console → Project Settings → Your Apps → Web App
 */

// ── Firebase Configuration & Client Manager ────────────────
const FirebaseAuth = {
  app: null,
  auth: null,
  googleProvider: null,
  initialized: false,
  isRealConfig: false,
  config: null,
  pendingRole: 'customer',

  async init() {
    if (this.initialized) return true;

    // 1. Fetch config from backend
    try {
      const res = await api.get('/auth/firebase-config');
      if (res && res.isConfigured && res.config && res.config.apiKey) {
        this.config = res.config;
        this.isRealConfig = true;
      } else {
        this.isRealConfig = false;
        this.config = res?.config || null;
      }
    } catch (e) {
      console.warn('Could not fetch Firebase config:', e.message);
      this.isRealConfig = false;
    }

    // 2. If real config, initialize Firebase SDK
    if (this.isRealConfig && typeof firebase !== 'undefined') {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(this.config);
        }
        this.auth = firebase.auth();
        this.googleProvider = new firebase.auth.GoogleAuthProvider();
        this.googleProvider.addScope('email');
        this.googleProvider.addScope('profile');
        this.initialized = true;
        console.log('✅ Firebase Authentication initialized with Google provider');
        return true;
      } catch (err) {
        console.warn('Firebase initialize error:', err.message);
        this.isRealConfig = false;
      }
    }

    this.initialized = true;
    return true;
  },

  // ── Google Sign-In ───────────────────────────────────────
  async signInWithGoogle(role = 'customer') {
    await this.init();
    this.pendingRole = role;

    // A. Real Firebase Google Sign-In with official popup
    if (this.isRealConfig && this.auth && this.googleProvider) {
      const result = await this.auth.signInWithPopup(this.googleProvider);
      const idToken = await result.user.getIdToken();
      const googleUser = {
        uid: result.user.uid,
        email: result.user.email,
        name: result.user.displayName,
        picture: result.user.photoURL
      };

      // Send to backend for session JWT generation and DB sync
      const res = await api.post('/auth/firebase-login', {
        idToken,
        googleUser,
        role: this.pendingRole
      });
      return res;
    }

    // B. Interactive Google Account Sandbox (when Firebase is in test/setup mode)
    return new Promise((resolve, reject) => {
      this._googleLoginResolve = resolve;
      this._googleLoginReject = reject;
      openModal('modal-google-signin');
    });
  },

  // Complete Google sign-in from sandbox modal
  async completeGoogleSandbox(email, name, picture) {
    try {
      showToast('Signing in with Google...', 'warning');
      const res = await api.post('/auth/firebase-login', {
        demoUser: {
          email,
          name,
          picture,
          uid: 'google_' + btoa(email).replace(/=/g, '')
        },
        role: this.pendingRole || 'customer'
      });

      closeModal();
      if (this._googleLoginResolve) {
        this._googleLoginResolve(res);
        this._googleLoginResolve = null;
      } else {
        api.setSession(res.token, res.user);
        showToast(`🎉 Signed in with Google as ${res.user.name}!`);
        if (window.AuthUI) AuthUI.afterLogin(res.user);
      }
      return res;
    } catch (err) {
      showToast(err.message || 'Google sign-in failed', 'error');
      if (this._googleLoginReject) {
        this._googleLoginReject(err);
        this._googleLoginReject = null;
      }
    }
  },

  // ── Firebase Email/Password Auth ─────────────────────────
  async signUpWithEmail(email, password) {
    await this.init();
    if (this.isRealConfig && this.auth) {
      return this.auth.createUserWithEmailAndPassword(email, password);
    }
    return true;
  },

  async signInWithEmail(email, password) {
    await this.init();
    if (this.isRealConfig && this.auth) {
      return this.auth.signInWithEmailAndPassword(email, password);
    }
    return true;
  },

  // ── Sign Out (Firebase + local session) ──────────────────
  async signOut() {
    if (this.isRealConfig && this.auth) {
      try { await this.auth.signOut(); } catch (e) { /* ignore */ }
    }
    api.clearSession();
  }
};

window.FirebaseAuth = FirebaseAuth;

// ═══════════════════════════════════════════════════════════
// RideLink Auth UI Controller
// ═══════════════════════════════════════════════════════════
const AuthUI = {
  // ── Open Auth Modal on specific tab ─────────────────────
  openLogin() {
    this.switchTab('tab-login');
    openModal('modal-auth');
  },

  openRegister() {
    this.switchTab('tab-register');
    openModal('modal-auth');
  },

  openForgotPassword() {
    this.switchTab('tab-forgot');
    openModal('modal-auth');
  },

  switchTab(tabId) {
    document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-tab-content').forEach(c => {
      c.classList.remove('active');
      c.style.display = 'none';
    });
    const btn = document.querySelector(`[data-target="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (btn) btn.classList.add('active');
    if (content) {
      content.classList.add('active');
      content.style.display = 'block';
    }
  },

  // ── Form Validation ──────────────────────────────────────
  validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const errEl = document.getElementById(`${inputId}-error`);
    if (input) input.classList.add('input-error');
    if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
  },

  clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    const errEl = document.getElementById(`${inputId}-error`);
    if (input) input.classList.remove('input-error');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  },

  clearAllErrors(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    form.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
  },

  setLoading(btnId, loading, text = 'Loading...') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
    } else {
      btn.innerHTML = btn.dataset.originalText || text;
    }
  },

  // ── Login Handler ────────────────────────────────────────
  async handleLogin(e) {
    e.preventDefault();
    this.clearAllErrors('form-login');

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    let valid = true;

    if (!email) { this.showFieldError('login-email', 'Email is required'); valid = false; }
    else if (!this.validateEmail(email)) { this.showFieldError('login-email', 'Enter a valid email address'); valid = false; }
    if (!password) { this.showFieldError('login-password', 'Password is required'); valid = false; }

    if (!valid) return;

    this.setLoading('btn-login-submit', true, 'Signing in...');

    try {
      const res = await api.post('/auth/login', { email, password });
      api.setSession(res.token, res.user);
      closeModal();
      showToast(res.message);
      this.afterLogin(res.user);
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
      const errBanner = document.getElementById('login-error-banner');
      if (errBanner) { errBanner.textContent = err.message || 'Invalid credentials'; errBanner.style.display = 'block'; }
    } finally {
      this.setLoading('btn-login-submit', false);
    }
  },

  // ── Register Handler ─────────────────────────────────────
  async handleRegister(e) {
    e.preventDefault();
    this.clearAllErrors('form-register');

    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password')?.value;
    const role = document.querySelector('input[name="reg-role"]:checked')?.value || 'customer';

    let valid = true;
    if (!name) { this.showFieldError('reg-name', 'Full name is required'); valid = false; }
    if (!email) { this.showFieldError('reg-email', 'Email is required'); valid = false; }
    else if (!this.validateEmail(email)) { this.showFieldError('reg-email', 'Enter a valid email address'); valid = false; }
    if (!phone) { this.showFieldError('reg-phone', 'Phone number is required'); valid = false; }
    if (!password || password.length < 6) { this.showFieldError('reg-password', 'Password must be at least 6 characters'); valid = false; }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      this.showFieldError('reg-confirm-password', 'Passwords do not match');
      valid = false;
    }

    const termsChecked = document.getElementById('reg-terms-check')?.checked;
    if (!termsChecked) {
      const errEl = document.getElementById('reg-terms-error');
      if (errEl) {
        errEl.textContent = 'You must read and agree to the Terms and Conditions and Privacy Policy.';
        errEl.style.display = 'block';
      }
      showToast('Please agree to the Terms and Conditions and Privacy Policy to create an account.', 'warning');
      valid = false;
    }

    if (!valid) return;

    this.setLoading('btn-register-submit', true, 'Creating account...');

    try {
      const res = await api.post('/auth/register', { name, email, phone, password, role, agree_terms: true });
      api.setSession(res.token, res.user);
      const loginEmailInput = document.getElementById('login-email');
      if (loginEmailInput) loginEmailInput.value = email;
      const regForm = document.getElementById('form-register');
      if (regForm) regForm.reset();
      closeModal();
      showToast(`Welcome to RideLink, ${res.user.name}! 🎉`);
      this.afterLogin(res.user);
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
      const errBanner = document.getElementById('register-error-banner');
      if (errBanner) { errBanner.textContent = err.message || 'Registration failed'; errBanner.style.display = 'block'; }
    } finally {
      this.setLoading('btn-register-submit', false);
    }
  },

  // ── Forgot Password Handler ──────────────────────────────
  async handleForgotPassword(e) {
    e.preventDefault();
    this.clearAllErrors('form-forgot');

    const email = document.getElementById('forgot-email').value.trim();
    if (!email || !this.validateEmail(email)) {
      this.showFieldError('forgot-email', 'Enter a valid email address');
      return;
    }

    this.setLoading('btn-forgot-submit', true, 'Sending OTP...');

    try {
      const res = await api.post('/auth/forgot-password', { email });
      showToast('OTP sent! Check your email.');

      // Show OTP reset form
      const otpSection = document.getElementById('forgot-otp-section');
      if (otpSection) otpSection.style.display = 'block';

      // In dev mode, show the OTP from the response
      if (res.demoOtp) {
        const hint = document.getElementById('forgot-otp-hint');
        if (hint) hint.textContent = `Demo OTP: ${res.demoOtp}`;
      }
    } catch (err) {
      showToast(err.message || 'Request failed', 'error');
    } finally {
      this.setLoading('btn-forgot-submit', false);
    }
  },

  async handleResetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const otp = document.getElementById('forgot-otp').value.trim();
    const newPassword = document.getElementById('forgot-new-password').value;

    if (!otp || !newPassword || newPassword.length < 6) {
      showToast('Enter OTP and a password of at least 6 characters', 'error');
      return;
    }

    this.setLoading('btn-reset-submit', true, 'Resetting...');

    try {
      await api.post('/auth/reset-password', { email, otp, newPassword });
      showToast('Password reset! Please log in with your new password.');
      this.switchTab('tab-login');
    } catch (err) {
      showToast(err.message || 'Reset failed', 'error');
    } finally {
      this.setLoading('btn-reset-submit', false);
    }
  },

  // ── Google Sign-In ───────────────────────────────────────
  async handleGoogleSignIn(role = 'customer') {
    const btns = document.querySelectorAll('[data-action="google-signin"]');
    btns.forEach(b => b.disabled = true);

    try {
      const res = await FirebaseAuth.signInWithGoogle(role);
      if (res && res.token && res.user) {
        api.setSession(res.token, res.user);
        closeModal();
        showToast(`🎉 Signed in with Google as ${res.user.name}!`);
        this.afterLogin(res.user);
      }
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        showToast('Google sign-in was cancelled.', 'warning');
      } else if (err.code === 'auth/popup-blocked') {
        showToast('Popup was blocked by your browser. Please allow popups for localhost.', 'error');
      } else if (err.code === 'auth/unauthorized-domain') {
        showToast('Domain unauthorized in Firebase. Add "localhost" under Authorized Domains in Firebase Console.', 'error');
      } else if (err.code === 'auth/operation-not-allowed') {
        showToast('Google Sign-In is not enabled in Firebase Console. Enable Google under Sign-in method.', 'error');
      } else if (err.code === 'auth/invalid-api-key') {
        showToast('Invalid Firebase API key in .env. Please check Firebase Console.', 'error');
      } else {
        showToast(err.message || 'Google sign-in failed.', 'error');
      }
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  },

  // ── After successful login ────────────────────────────────
  afterLogin(user) {
    if (user.role === 'owner') navigateTo('owner-dash');
    else if (user.role === 'admin') navigateTo('admin-dash');
    else navigateTo('marketplace');
  },

  // ── Logout ───────────────────────────────────────────────
  async handleLogout() {
    await FirebaseAuth.signOut();
    showToast('Logged out successfully.');
    navigateTo('marketplace');
  }
};

window.AuthUI = AuthUI;
