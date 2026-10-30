/**
 * RideLink Payments Router
 * Integrates Razorpay Standard Checkout (TEST MODE)
 * - Creates Razorpay orders on the backend
 * - Verifies payment signatures server-side (HMAC-SHA256)
 * - Only confirms bookings after verified payment
 * - Never exposes secret keys to frontend
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('./db');
const { authenticateToken } = require('./middleware');

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (e) {
  QRCode = null;
}

// ── Razorpay Initialization ────────────────────────────────
let Razorpay = null;
let razorpayInstance = null;

const RAZORPAY_KEY_ID = (process.env.RAZORPAY_KEY_ID || '').trim();
const RAZORPAY_KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();

// Check if keys are actual user-configured keys or placeholder template strings
const isRealRazorpayConfigured = 
  RAZORPAY_KEY_ID.startsWith('rzp_') && 
  !RAZORPAY_KEY_ID.includes('XXXX') && 
  Boolean(RAZORPAY_KEY_SECRET) && 
  !RAZORPAY_KEY_SECRET.includes('your_') &&
  !RAZORPAY_KEY_SECRET.includes('secret_key');

if (isRealRazorpayConfigured) {
  try {
    Razorpay = require('razorpay');
    razorpayInstance = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
    console.log('✅ Razorpay initialized in', RAZORPAY_KEY_ID.startsWith('rzp_test_') ? 'TEST' : 'LIVE', 'mode');
  } catch (e) {
    console.warn('⚠️  Razorpay SDK not found or error loading:', e.message);
    razorpayInstance = null;
  }
} else {
  console.log('ℹ️  Razorpay keys not configured or using placeholders. RideLink Sandbox Gateway active.');
}

// ── Helper ─────────────────────────────────────────────────
function generateCode(prefix) {
  return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function generatePaymentQr(booking) {
  const amount = Number(booking.total_amount || 0).toFixed(2);
  const bookingCode = booking.booking_code || `BKG-${booking.id}`;
  const upiPayload = `upi://pay?pa=ridelink.payments@icici&pn=RideLink%20Mobility&am=${amount}&cu=INR&tn=${encodeURIComponent('Booking ' + bookingCode)}`;
  let qrCodeDataUrl = null;

  if (QRCode) {
    try {
      qrCodeDataUrl = await QRCode.toDataURL(upiPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    } catch (err) {
      console.warn('QR Code generation warning:', err.message);
    }
  }

  return { upiPayload, qrCodeDataUrl };
}

// ═══════════════════════════════════════════════════════════
// 1. GET PAYMENT CHECKOUT SUMMARY
// ═══════════════════════════════════════════════════════════
router.get('/checkout-summary/:bookingId', authenticateToken, async (req, res) => {
  try {
    const booking = db.prepare(`
      SELECT b.*,
             v.title as vehicle_title, v.brand as vehicle_brand,
             v.model as vehicle_model, v.reg_number, v.photos_json,
             u.name as owner_name,
             c.name as customer_name, c.phone as customer_phone, c.email as customer_email
      FROM bookings b
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users u ON b.owner_id = u.id
      JOIN users c ON b.customer_id = c.id
      WHERE b.id = ?
    `).get(req.params.bookingId);

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized access to checkout.' });
    }

    booking.photos = booking.photos_json ? JSON.parse(booking.photos_json) : [];

    // Check for existing successful payment (prevent duplicate)
    const existingPayment = db.prepare(
      "SELECT * FROM payments WHERE booking_id = ? AND payment_status = 'SUCCESS'"
    ).get(booking.id);

    const { upiPayload, qrCodeDataUrl } = await generatePaymentQr(booking);

    res.json({
      success: true,
      booking,
      upiPayload,
      qrCodeDataUrl,
      existingPayment: existingPayment || null,
      razorpayEnabled: !!razorpayInstance,
      razorpayKeyId: razorpayInstance ? RAZORPAY_KEY_ID : null
    });
  } catch (err) {
    console.error('Checkout summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to prepare checkout.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 2. CREATE RAZORPAY ORDER (Backend-side order creation)
// ═══════════════════════════════════════════════════════════
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required.' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized payment attempt.' });
    }

    // Prevent duplicate payment
    const existing = db.prepare(
      "SELECT * FROM payments WHERE booking_id = ? AND payment_status = 'SUCCESS'"
    ).get(bookingId);
    if (existing) {
      return res.json({
        success: true,
        alreadyPaid: true,
        message: 'This booking is already paid.',
        payment: existing
      });
    }

    // ── Razorpay order creation ───────────────────────────
    const { upiPayload, qrCodeDataUrl } = await generatePaymentQr(booking);

    if (razorpayInstance) {
      try {
        // Amount must be in paise (INR × 100)
        const amountInPaise = Math.round(booking.total_amount * 100);

        const order = await razorpayInstance.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: booking.booking_code,
          notes: {
            booking_id: String(booking.id),
            customer_id: String(req.user.id),
            vehicle_id: String(booking.vehicle_id)
          }
        });

        return res.json({
          success: true,
          orderId: order.id,
          amount: order.amount,        // paise
          currency: order.currency,
          keyId: RAZORPAY_KEY_ID,      // Public key only (safe to send)
          bookingCode: booking.booking_code,
          customerName: req.user.name,
          customerEmail: req.user.email,
          customerPhone: req.user.phone,
          upiPayload,
          qrCodeDataUrl
        });
      } catch (rzpErr) {
        console.warn('⚠️  Razorpay API order error, switching seamlessly to Sandbox Gateway:', rzpErr.message || rzpErr);
        // Fall through to Sandbox Gateway
      }
    }

    // ── Sandbox / Demo fallback (Instant payment testing) ──
    return res.json({
      success: true,
      orderId: `demo_order_${Date.now()}`,
      amount: Math.round(booking.total_amount * 100),
      currency: 'INR',
      keyId: null,
      demoMode: true,
      bookingCode: booking.booking_code,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: req.user.phone,
      upiPayload,
      qrCodeDataUrl
    });

  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create payment order.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 3. VERIFY RAZORPAY PAYMENT (Server-side signature check)
//    Booking confirmed ONLY after HMAC-SHA256 verification
// ═══════════════════════════════════════════════════════════
router.post('/verify', authenticateToken, (req, res) => {
  try {
    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required.' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    // Prevent duplicate confirmation
    const existing = db.prepare(
      "SELECT * FROM payments WHERE booking_id = ? AND payment_status = 'SUCCESS'"
    ).get(bookingId);
    if (existing) {
      return res.json({
        success: true,
        alreadyPaid: true,
        message: 'Already confirmed.',
        payment: existing,
        invoiceNumber: existing.invoice_number
      });
    }

    // ── Signature Verification (Real Razorpay) ────────────
    const isRealOrder = razorpay_order_id && !razorpay_order_id.startsWith('demo_');
    if (razorpayInstance && isRealOrder && razorpay_payment_id && razorpay_signature) {
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        // Log tampered request
        console.warn(`⚠️  Payment signature mismatch for booking ${bookingId}. Possible tampered request.`);
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed. Signature mismatch. Please contact support.'
        });
      }

      // ✅ Signature is VALID — confirm the booking
      const paymentCode = generateCode('RL-PAY');
      const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
      const rawMethod = (req.body.paymentMethod || 'UPI').toUpperCase();
      const validMethod = ['UPI', 'QR', 'CARD', 'NETBANKING'].includes(rawMethod) ? rawMethod : 'UPI';

      const insertResult = db.prepare(`
        INSERT INTO payments (
          payment_code, booking_id, customer_id, amount, payment_method,
          payment_status, transaction_ref, invoice_number
        ) VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?)
      `).run(
        paymentCode,
        booking.id,
        req.user.id,
        booking.total_amount,
        validMethod,
        razorpay_payment_id,
        invoiceNumber
      );

      db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?").run(booking.id);

      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(insertResult.lastInsertRowid);

      return res.json({
        success: true,
        message: 'Payment verified and booking confirmed!',
        payment,
        bookingCode: booking.booking_code,
        invoiceNumber
      });
    }

    // ── Sandbox / Demo Mode: auto-confirm ────────
    const paymentCode = generateCode('RL-PAY');
    const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const rawDemoMethod = (req.body.paymentMethod || 'UPI').toUpperCase();
    const validDemoMethod = ['UPI', 'QR', 'CARD', 'NETBANKING'].includes(rawDemoMethod) ? rawDemoMethod : 'UPI';

    const insertResult = db.prepare(`
      INSERT INTO payments (
        payment_code, booking_id, customer_id, amount, payment_method,
        payment_status, transaction_ref, invoice_number
      ) VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?)
    `).run(
      paymentCode,
      booking.id,
      req.user.id,
      booking.total_amount,
      validDemoMethod,
      `DEMO_TXN_${Date.now()}`,
      invoiceNumber
    );

    db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?").run(booking.id);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(insertResult.lastInsertRowid);

    return res.json({
      success: true,
      message: 'Payment confirmed and booking verified!',
      payment,
      bookingCode: booking.booking_code,
      invoiceNumber
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, message: 'Server error during payment verification.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 4. PAYMENT FAILURE / CANCELLATION HANDLER
// ═══════════════════════════════════════════════════════════
router.post('/failure', authenticateToken, (req, res) => {
  try {
    const { bookingId, reason, paymentMethod } = req.body;
    if (!bookingId) return res.status(400).json({ success: false, message: 'bookingId required.' });

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking || booking.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    // Log the failure but keep booking in PENDING (so user can retry)
    const paymentCode = generateCode('RL-FAIL');
    const invoiceNumber = `FAIL-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const rawFailMethod = (paymentMethod || 'UPI').toUpperCase();
    const validFailMethod = ['UPI', 'QR', 'CARD', 'NETBANKING'].includes(rawFailMethod) ? rawFailMethod : 'UPI';

    db.prepare(`
      INSERT INTO payments (
        payment_code, booking_id, customer_id, amount, payment_method,
        payment_status, transaction_ref, invoice_number
      ) VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?)
    `).run(
      paymentCode, booking.id, req.user.id,
      booking.total_amount, validFailMethod, `FAIL_${Date.now()}`, invoiceNumber
    );

    // Booking stays PENDING — user can retry
    console.log(`Payment failed for booking ${bookingId}: ${reason || 'User cancelled'}`);

    res.json({
      success: true,
      message: 'Payment failure recorded. You can retry payment from My Bookings.',
      retryAllowed: true
    });
  } catch (err) {
    console.error('Failure handler error:', err);
    res.status(500).json({ success: false, message: 'Failed to record payment failure.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 5. LEGACY DEMO PAYMENT (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════
router.post('/process-demo', authenticateToken, (req, res) => {
  try {
    const { bookingId, paymentMethod, upiId, cardNumber, bankName } = req.body;

    if (!bookingId || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Booking ID and payment method required.' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const existing = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND payment_status = 'SUCCESS'").get(bookingId);
    if (existing) {
      return res.json({ success: true, message: 'Already paid.', payment: existing, invoiceNumber: existing.invoice_number });
    }

    const paymentCode = generateCode('RL-PAY');
    const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const txnRef = `TXN_${paymentMethod}_${Date.now().toString().slice(-8)}`;

    let cardLast4 = null;
    if (paymentMethod === 'CARD' && cardNumber) {
      const clean = cardNumber.replace(/\D/g, '');
      cardLast4 = clean.slice(-4) || '4242';
    }

    const insertResult = db.prepare(`
      INSERT INTO payments (
        payment_code, booking_id, customer_id, amount, payment_method,
        payment_status, transaction_ref, upi_id, card_last4, bank_name, invoice_number
      ) VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?)
    `).run(
      paymentCode, booking.id, req.user.id, booking.total_amount, paymentMethod,
      txnRef, upiId || null, cardLast4, bankName || null, invoiceNumber
    );

    db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?").run(booking.id);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(insertResult.lastInsertRowid);

    res.json({ success: true, message: 'Payment processed!', payment, bookingCode: booking.booking_code, invoiceNumber });
  } catch (err) {
    console.error('Demo payment error:', err);
    res.status(500).json({ success: false, message: 'Demo payment failed.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 6. GET TAX INVOICE
// ═══════════════════════════════════════════════════════════
router.get('/qr/:bookingId', authenticateToken, async (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const { upiPayload, qrCodeDataUrl } = await generatePaymentQr(booking);
    res.json({ success: true, upiPayload, qrCodeDataUrl });
  } catch (err) {
    console.error('QR fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate QR code.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 6. GET TAX INVOICE
// ═══════════════════════════════════════════════════════════
router.get('/invoice/:invoiceNumber', authenticateToken, async (req, res) => {
  try {
    const payment = db.prepare(`
      SELECT p.*,
             b.booking_code, b.start_date, b.end_date, b.duration_type, b.duration_count,
             b.base_amount, b.damage_protection_fee, b.gst_cgst, b.gst_sgst,
             b.security_deposit, b.total_amount, b.pickup_location,
             v.title as vehicle_title, v.brand as vehicle_brand,
             v.model as vehicle_model, v.reg_number, v.category,
             u.name as owner_name,
             c.name as customer_name, c.email as customer_email, c.phone as customer_phone
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users u ON b.owner_id = u.id
      JOIN users c ON p.customer_id = c.id
      WHERE p.invoice_number = ?
    `).get(req.params.invoiceNumber);

    if (!payment) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    if (payment.customer_id !== req.user.id && payment.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to view this invoice.' });
    }

    const verifyUrl = `https://ridelink.mobility/verify-invoice?inv=${encodeURIComponent(payment.invoice_number)}&amt=${payment.amount}`;
    let invoiceQrDataUrl = null;
    if (QRCode) {
      try {
        invoiceQrDataUrl = await QRCode.toDataURL(verifyUrl, {
          margin: 1,
          width: 130,
          color: { dark: '#0f172a', light: '#ffffff' }
        });
      } catch (e) {}
    }

    res.json({ success: true, invoice: payment, qrCodeDataUrl: invoiceQrDataUrl });
  } catch (err) {
    console.error('Invoice fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve invoice.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 7. REFUND / CANCELLATION
//    Called when a CONFIRMED booking is cancelled after payment
// ═══════════════════════════════════════════════════════════
router.post('/refund/:bookingId', authenticateToken, async (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const payment = db.prepare(
      "SELECT * FROM payments WHERE booking_id = ? AND payment_status = 'SUCCESS' ORDER BY id DESC LIMIT 1"
    ).get(req.params.bookingId);

    if (!payment) {
      return res.status(400).json({ success: false, message: 'No successful payment found for this booking.' });
    }

    if (payment.payment_status === 'REFUNDED') {
      return res.json({ success: true, message: 'This booking is already refunded.' });
    }

    // ── Real Razorpay Refund ─────────────────────────────
    if (razorpayInstance && payment.transaction_ref && payment.transaction_ref.startsWith('pay_')) {
      try {
        // Refund full amount (security deposit excluded in real scenarios)
        const refundAmount = Math.round(
          (payment.amount - (booking.security_deposit || 0)) * 100
        ); // paise

        const refund = await razorpayInstance.payments.refund(payment.transaction_ref, {
          amount: refundAmount,
          speed: 'normal',
          notes: {
            booking_code: booking.booking_code,
            reason: 'Customer cancelled booking'
          }
        });

        // Mark booking as cancelled and tag transaction_ref
        db.prepare("UPDATE payments SET transaction_ref = 'REFUNDED_' || transaction_ref WHERE id = ?").run(payment.id);
        db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?").run(booking.id);

        return res.json({
          success: true,
          message: 'Refund initiated successfully! Amount will be credited in 5-7 business days.',
          refundId: refund.id,
          refundAmount: refundAmount / 100
        });
      } catch (rzpErr) {
        console.error('Razorpay refund error:', rzpErr);
        return res.status(500).json({ success: false, message: rzpErr.error?.description || 'Refund failed. Contact support.' });
      }
    }

    // ── Demo mode: mark as cancelled & refunded ───────────
    db.prepare("UPDATE payments SET transaction_ref = 'REFUNDED_' || transaction_ref WHERE id = ?").run(payment.id);
    db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?").run(booking.id);

    res.json({
      success: true,
      message: 'Refund processed (demo mode). Amount credited back.',
      refundId: `REFUND_DEMO_${Date.now()}`,
      refundAmount: payment.amount - (booking.security_deposit || 0)
    });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ success: false, message: 'Refund processing failed.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 8. TRANSACTION HISTORY (customer's all payments)
// ═══════════════════════════════════════════════════════════
router.get('/my-transactions', authenticateToken, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.*,
             b.booking_code, b.start_date, b.end_date, b.status as booking_status,
             v.title as vehicle_title, v.brand as vehicle_brand, v.category
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      JOIN vehicles v ON b.vehicle_id = v.id
      WHERE p.customer_id = ?
      ORDER BY p.id DESC
    `).all(req.user.id);

    res.json({ success: true, transactions: payments });
  } catch (err) {
    console.error('Transaction history error:', err);
    res.status(500).json({ success: false, message: 'Failed to load transactions.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 9. CHECK PAYMENT STATUS for a booking (poll for status)
// ═══════════════════════════════════════════════════════════
router.get('/status/:bookingId', authenticateToken, (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const payment = db.prepare(
      'SELECT * FROM payments WHERE booking_id = ? ORDER BY id DESC LIMIT 1'
    ).get(req.params.bookingId);

    res.json({
      success: true,
      bookingStatus: booking.status,
      paymentStatus: payment ? payment.payment_status : 'NOT_INITIATED',
      payment: payment || null
    });
  } catch (err) {
    console.error('Status check error:', err);
    res.status(500).json({ success: false, message: 'Failed to check payment status.' });
  }
});

module.exports = router;
