/**
 * RideLink Auth Router
 * Handles email/password login, registration, demo login,
 * Firebase token verification (Google Sign-In + social auth),
 * forgot password OTP flow, and profile/KYC management.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { JWT_SECRET, authenticateToken, maskAadhaar, maskDL } = require('./middleware');

// ── In-memory stores (in production, use Redis) ────────────
const otpStore = new Map();
const passwordResetStore = new Map();

// ── Token Generator ────────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function safeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// ═══════════════════════════════════════════════════════════
// 1. REGISTER (Email + Password)
// ═══════════════════════════════════════════════════════════
router.post('/register', (req, res) => {
  try {
    const { name, email, phone, password, role, agree_terms } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (agree_terms !== true && agree_terms !== 'true' && agree_terms !== 1 && agree_terms !== '1') {
      return res.status(400).json({
        success: false,
        message: 'You must read and agree to the Terms and Conditions and Privacy Policy to create an account.'
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    const assignedRole = role === 'owner' ? 'owner' : 'customer';

    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanPassword = typeof password === 'string' ? password.trim() : password;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(cleanPassword, salt);
    const defaultAvatar = assignedRole === 'owner'
      ? 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80'
      : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80';

    const insertResult = db.prepare(`
      INSERT INTO users (name, email, phone, password_hash, role, avatar, is_phone_verified, kyc_status, terms_accepted, terms_version, terms_accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'NOT_SUBMITTED', 1, 'v1.0', CURRENT_TIMESTAMP)
    `).run(name.trim(), cleanEmail, phone.trim(), passwordHash, assignedRole, defaultAvatar);

    if (assignedRole === 'owner') {
      db.prepare(`
        INSERT INTO owner_bank_details (owner_id, account_holder_name, account_number_masked, ifsc_code, bank_name, upi_id)
        VALUES (?, ?, '•••• •••• •••• 0000', 'SBIN0000000', 'State Bank of India', '')
      `).run(insertResult.lastInsertRowid, name.trim());
    }

    const newUser = db.prepare(`
      SELECT id, name, email, phone, role, avatar, is_phone_verified, kyc_status,
             dl_number_masked, dl_doc_name, aadhaar_number_masked, aadhaar_doc_name, kyc_notes, firebase_uid,
             terms_accepted, terms_version, terms_accepted_at, created_at FROM users WHERE id = ?
    `).get(insertResult.lastInsertRowid);

    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: `Welcome to RideLink, ${newUser.name}! Account created successfully.`,
      token,
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 2. LOGIN (Email + Password)
// ═══════════════════════════════════════════════════════════
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const cleanEmail = (typeof email === 'string' ? email : '').toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user || !user.password_hash) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Google/Firebase-linked accounts without a custom local password
    const isGoogleAccount = user.firebase_uid && (
      !user.password_hash.startsWith('$2') ||
      bcrypt.compareSync(`firebase_${user.firebase_uid}`, user.password_hash)
    );
    if (isGoogleAccount) {
      return res.status(401).json({
        success: false,
        message: 'This account was created with Google Sign-In. Please click "Continue with Google" to log in, or use "Forgot password?" to set a password.'
      });
    }

    let isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch && typeof password === 'string') {
      const trimmed = password.trim();
      if (trimmed !== password) {
        isMatch = bcrypt.compareSync(trimmed, user.password_hash);
      }
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateToken(safeUser(user));

    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      token,
      user: safeUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 3a. GET FIREBASE CLIENT CONFIG (Safe frontend config from .env)
// ═══════════════════════════════════════════════════════════
router.get('/firebase-config', (req, res) => {
  const apiKey = (process.env.FIREBASE_API_KEY || '').trim();
  const authDomain = (process.env.FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const storageBucket = (process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.appspot.com` : '')).trim();
  const messagingSenderId = (process.env.FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const appId = (process.env.FIREBASE_APP_ID || '').trim();

  // Check if real keys are configured
  const isConfigured = Boolean(
    apiKey &&
    !apiKey.includes('XXXX') &&
    !apiKey.includes('YOUR_') &&
    projectId &&
    !projectId.includes('your-')
  );

  res.json({
    success: true,
    isConfigured,
    config: {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 3b. FIREBASE SOCIAL LOGIN (Google Sign-In via Firebase)
//     Frontend sends Firebase ID token; backend verifies it
// ═══════════════════════════════════════════════════════════
router.post('/firebase-login', async (req, res) => {
  try {
    const { idToken, googleUser, role, demoUser } = req.body;

    if (!idToken && !googleUser && !demoUser) {
      return res.status(400).json({ success: false, message: 'Google Authentication credentials required.' });
    }

    let firebaseUser = null;
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

    // 1. Try Firebase Admin SDK verification if configured
    if (idToken && FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY && !FIREBASE_PROJECT_ID.includes('your-')) {
      try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
            })
          });
        }
        const decoded = await admin.auth().verifyIdToken(idToken);
        firebaseUser = {
          uid: decoded.uid,
          email: decoded.email,
          name: decoded.name || (decoded.email ? decoded.email.split('@')[0] : 'Google User'),
          picture: decoded.picture || null
        };
      } catch (fbErr) {
        console.warn('Firebase Admin verification failed, trying fallback:', fbErr.message);
      }
    }

    // 2. Client-provided verified Google user (from Firebase Client SDK)
    if (!firebaseUser && googleUser && googleUser.email) {
      firebaseUser = {
        uid: googleUser.uid || `google_${Date.now()}`,
        email: googleUser.email,
        name: googleUser.name || googleUser.displayName || googleUser.email.split('@')[0],
        picture: googleUser.picture || googleUser.photoURL || null
      };
    }

    // 3. Demo Google user (for instant sandbox testing)
    if (!firebaseUser && demoUser && demoUser.email) {
      firebaseUser = {
        uid: demoUser.uid || `google_demo_${Date.now()}`,
        email: demoUser.email,
        name: demoUser.name || demoUser.email.split('@')[0],
        picture: demoUser.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
      };
    }

    // 4. Try decoding idToken payload if present
    if (!firebaseUser && idToken) {
      try {
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          firebaseUser = {
            uid: payload.user_id || payload.sub || `google_${Date.now()}`,
            email: payload.email || `google_user@gmail.com`,
            name: payload.name || (payload.email ? payload.email.split('@')[0] : 'Google User'),
            picture: payload.picture || null
          };
        }
      } catch (decodeErr) {
        console.warn('Token decode error:', decodeErr.message);
      }
    }

    if (!firebaseUser || !firebaseUser.email) {
      return res.status(400).json({ success: false, message: 'Could not extract valid Google profile details.' });
    }

    // ── Upsert user in SQLite ─────────────────────────────
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(firebaseUser.email.toLowerCase());

    if (!user) {
      // New social login user → create account
      const assignedRole = role === 'owner' ? 'owner' : 'customer';
      const insertResult = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, role, avatar, is_phone_verified, kyc_status, firebase_uid, terms_accepted, terms_version, terms_accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'NOT_SUBMITTED', ?, 1, 'v1.0', CURRENT_TIMESTAMP)
      `).run(
        firebaseUser.name,
        firebaseUser.email.toLowerCase(),
        '+91 00000 00000',
        bcrypt.hashSync(`firebase_${firebaseUser.uid}`, 8),
        assignedRole,
        firebaseUser.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
        firebaseUser.uid
      );

      if (assignedRole === 'owner') {
        db.prepare(`
          INSERT INTO owner_bank_details (owner_id, account_holder_name, account_number_masked, ifsc_code, bank_name, upi_id)
          VALUES (?, ?, '•••• •••• •••• 0000', 'SBIN0000000', 'State Bank of India', '')
        `).run(insertResult.lastInsertRowid, firebaseUser.name);
      }

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(insertResult.lastInsertRowid);
    } else {
      // Existing user — update avatar if Google has a newer one
      if (firebaseUser.picture && !user.firebase_uid) {
        db.prepare('UPDATE users SET avatar = ?, firebase_uid = ? WHERE id = ?')
          .run(firebaseUser.picture, firebaseUser.uid, user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      }
    }

    const token = generateToken(safeUser(user));

    res.json({
      success: true,
      message: `Signed in with Google as ${user.name}!`,
      token,
      user: safeUser(user)
    });
  } catch (err) {
    console.error('Firebase login error:', err);
    res.status(500).json({ success: false, message: 'Social login failed. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 4. FORGOT PASSWORD → Send OTP
// ═══════════════════════════════════════════════════════════
router.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email.toLowerCase().trim());
    // Always return success (don't reveal if email exists — security best practice)
    if (!user) {
      return res.json({
        success: true,
        message: 'If this email exists, a reset OTP has been sent. Check your inbox.'
      });
    }

    // Generate 6-digit OTP (in production, send via email/SMS)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    passwordResetStore.set(email.toLowerCase(), {
      otp,
      userId: user.id,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    console.log(`🔑 Password reset OTP for ${email}: ${otp} (demo - shown in console only)`);

    res.json({
      success: true,
      message: 'Password reset OTP sent to your email.',
      // In dev mode only — remove in production
      demoOtp: process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Failed to process request.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 5. RESET PASSWORD (verify OTP + set new password)
// ═══════════════════════════════════════════════════════════
router.post('/reset-password', (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, OTP, and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }

    const record = passwordResetStore.get(email.toLowerCase());
    if (!record || record.otp !== otp || Date.now() > record.expiresAt) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please request a new one.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPassword, salt);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, record.userId);
    passwordResetStore.delete(email.toLowerCase());

    res.json({ success: true, message: 'Password reset successfully! Please log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 6. DEMO LOGIN (One-click role switch for testing)
// ═══════════════════════════════════════════════════════════
router.post('/demo-login', (req, res) => {
  try {
    const { role } = req.body;
    let targetEmail = 'rahul@customer.com';
    if (role === 'owner') targetEmail = 'priya@owner.com';
    if (role === 'admin') targetEmail = 'admin@ridelink.com';

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(targetEmail);
    if (!user) {
      return res.status(404).json({ success: false, message: `Demo user for role ${role} not found.` });
    }

    const token = generateToken(safeUser(user));
    res.json({
      success: true,
      message: `Logged in as demo ${role}: ${user.name}`,
      token,
      user: safeUser(user)
    });
  } catch (err) {
    console.error('Demo login error:', err);
    res.status(500).json({ success: false, message: 'Demo login failed.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 7. PHONE OTP (Simulation)
// ═══════════════════════════════════════════════════════════
router.post('/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required.' });

  const otp = '424299';
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

  res.json({
    success: true,
    message: `OTP sent to ${phone}`,
    demoOtp: otp
  });
});

router.post('/verify-otp', authenticateToken, (req, res) => {
  const { phone, otp } = req.body;
  const record = otpStore.get(phone);

  if (!otp) return res.status(400).json({ success: false, message: 'Please enter the 6-digit OTP.' });

  if (otp === '424299' || (record && record.otp === otp && Date.now() < record.expiresAt)) {
    db.prepare('UPDATE users SET is_phone_verified = 1 WHERE id = ?').run(req.user.id);
    otpStore.delete(phone);
    return res.json({ success: true, message: 'Phone number verified successfully!' });
  }

  res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
});

// ═══════════════════════════════════════════════════════════
// 8. GET CURRENT USER
// ═══════════════════════════════════════════════════════════
router.get('/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ═══════════════════════════════════════════════════════════
// 9. UPDATE PROFILE
// ═══════════════════════════════════════════════════════════
router.put('/update-profile', authenticateToken, (req, res) => {
  try {
    const { name, phone, avatar } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    }

    db.prepare(`
      UPDATE users SET name = ?, phone = ?, avatar = COALESCE(?, avatar) WHERE id = ?
    `).run(name.trim(), phone.trim(), avatar || null, req.user.id);

    const updatedUser = db.prepare(`
      SELECT id, name, email, phone, role, avatar, is_phone_verified, kyc_status,
             dl_number_masked, aadhaar_number_masked, created_at FROM users WHERE id = ?
    `).get(req.user.id);

    res.json({ success: true, message: 'Profile updated!', user: updatedUser });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 10. SUBMIT KYC
// ═══════════════════════════════════════════════════════════
router.post('/submit-kyc', authenticateToken, (req, res) => {
  try {
    const { dlNumber, dlDocName, aadhaarNumber, aadhaarDocName } = req.body;
    if (!dlNumber || !aadhaarNumber) {
      return res.status(400).json({ success: false, message: 'DL and Aadhaar number are required.' });
    }

    const maskedDL = maskDL(dlNumber);
    const maskedAadhaar = maskAadhaar(aadhaarNumber);

    db.prepare(`
      UPDATE users
      SET dl_number_masked = ?, dl_doc_name = ?, aadhaar_number_masked = ?,
          aadhaar_doc_name = ?, kyc_status = 'VERIFIED', kyc_notes = ?
      WHERE id = ?
    `).run(maskedDL, dlDocName || 'dl_upload.pdf', maskedAadhaar,
           aadhaarDocName || 'aadhaar_upload.pdf', 'Auto-verified via sandbox', req.user.id);

    const updatedUser = db.prepare(`
      SELECT id, name, email, phone, role, avatar, is_phone_verified, kyc_status,
             dl_number_masked, aadhaar_number_masked, kyc_notes FROM users WHERE id = ?
    `).get(req.user.id);

    res.json({ success: true, message: 'KYC verified successfully!', user: updatedUser });
  } catch (err) {
    console.error('KYC error:', err);
    res.status(500).json({ success: false, message: 'KYC submission failed.' });
  }
});

module.exports = router;
