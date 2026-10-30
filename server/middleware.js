const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'ridelink-ultra-secure-key-2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Session expired or invalid token.' });
    }

    const user = db.prepare('SELECT id, name, email, phone, role, avatar, is_phone_verified, kyc_status, dl_number_masked, dl_doc_name, aadhaar_number_masked, aadhaar_doc_name, kyc_notes, created_at FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    req.user = user;
    next();
  });
}

function optionalToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      const user = db.prepare('SELECT id, name, email, phone, role, avatar, is_phone_verified, kyc_status, dl_number_masked, dl_doc_name, aadhaar_number_masked, aadhaar_doc_name, kyc_notes, created_at FROM users WHERE id = ?').get(decoded.id);
      if (user) {
        req.user = user;
      }
    }
    next();
  });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: `Access denied. Role '${role}' is required.` });
    }
    next();
  };
}

// Sensitive data masking helpers to ensure compliance
function maskAadhaar(aadhaar) {
  if (!aadhaar) return null;
  const cleaned = aadhaar.replace(/\D/g, '');
  if (cleaned.length < 4) return 'XXXX-XXXX-XXXX';
  const last4 = cleaned.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

function maskDL(dl) {
  if (!dl) return null;
  const cleaned = dl.trim().replace(/\s+/g, '-');
  if (cleaned.length <= 4) return 'DL-XXXX';
  const last4 = cleaned.slice(-4);
  const prefix = cleaned.slice(0, 5);
  return `${prefix}-XXXX-${last4}`;
}

function maskBankAccount(acc) {
  if (!acc) return null;
  const cleaned = acc.replace(/\D/g, '');
  if (cleaned.length < 4) return '•••• •••• ••••';
  const last4 = cleaned.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

module.exports = {
  JWT_SECRET,
  authenticateToken,
  optionalToken,
  requireRole,
  maskAadhaar,
  maskDL,
  maskBankAccount
};
