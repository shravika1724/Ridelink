const express = require('express');
const router = express.Router();
const db = require('./db');
const { authenticateToken, requireRole, maskBankAccount } = require('./middleware');

// Protect all owner routes
router.use(authenticateToken);
router.use(requireRole('owner'));

// 1. OWNER STATS & EARNINGS OVERVIEW
router.get('/stats', (req, res) => {
  try {
    const ownerId = req.user.id;

    // Total vehicles
    const fleetStats = db.prepare(`
      SELECT
        COUNT(*) as total_vehicles,
        SUM(CASE WHEN availability_status = 'AVAILABLE' THEN 1 ELSE 0 END) as available_vehicles,
        COALESCE(AVG(rating), 5.0) as average_rating
      FROM vehicles
      WHERE owner_id = ?
    `).get(ownerId);

    // Earnings and bookings
    const bookingsStats = db.prepare(`
      SELECT
        COUNT(*) as total_bookings,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed_bookings,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_bookings,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_bookings,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'COMPLETED') THEN base_amount ELSE 0 END), 0) as gross_earnings
      FROM bookings
      WHERE owner_id = ?
    `).get(ownerId);

    // Platform commission is 10% on base rental
    const grossEarnings = bookingsStats.gross_earnings || 0;
    const platformCommission = Math.round(grossEarnings * 0.10 * 100) / 100;
    const netPayout = Math.round((grossEarnings - platformCommission) * 100) / 100;

    res.json({
      success: true,
      stats: {
        totalVehicles: fleetStats.total_vehicles || 0,
        availableVehicles: fleetStats.available_vehicles || 0,
        averageRating: Math.round((fleetStats.average_rating || 5.0) * 10) / 10,
        totalBookings: bookingsStats.total_bookings || 0,
        pendingRequests: bookingsStats.pending_bookings || 0,
        confirmedTrips: bookingsStats.confirmed_bookings || 0,
        completedTrips: bookingsStats.completed_bookings || 0,
        grossEarnings,
        platformCommission,
        netPayout
      }
    });
  } catch (err) {
    console.error('Owner stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve owner analytics.' });
  }
});

// 2. GET OWNER'S LISTED VEHICLES
router.get('/vehicles', (req, res) => {
  try {
    const vehicles = db.prepare(`
      SELECT v.*,
             (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_id = v.id) as total_bookings_count
      FROM vehicles v
      WHERE v.owner_id = ?
      ORDER BY v.id DESC
    `).all(req.user.id);

    const formatted = vehicles.map(v => ({
      ...v,
      features: v.features_json ? JSON.parse(v.features_json) : [],
      photos: v.photos_json ? JSON.parse(v.photos_json) : []
    }));

    res.json({
      success: true,
      vehicles: formatted
    });
  } catch (err) {
    console.error('Owner vehicles error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch owner vehicles.' });
  }
});

// 3. GET OWNER'S BOOKING REQUESTS
router.get('/bookings', (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*,
             v.title as vehicle_title,
             v.reg_number,
             v.category,
             v.photos_json,
             c.name as customer_name,
             c.phone as customer_phone,
             c.email as customer_email,
             c.kyc_status as customer_kyc_status,
             p.payment_status,
             p.payment_method,
             p.invoice_number
      FROM bookings b
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users c ON b.customer_id = c.id
      LEFT JOIN payments p ON b.id = p.booking_id
      WHERE b.owner_id = ?
      ORDER BY b.id DESC
    `).all(req.user.id);

    const formatted = bookings.map(b => ({
      ...b,
      photos: b.photos_json ? JSON.parse(b.photos_json) : []
    }));

    res.json({
      success: true,
      bookings: formatted
    });
  } catch (err) {
    console.error('Owner bookings error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch booking requests.' });
  }
});

// 4. UPDATE BOOKING REQUEST STATUS (Approve, Reject, Complete)
router.patch('/bookings/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const bookingId = req.params.id;

    if (!['CONFIRMED', 'CANCELLED', 'ACTIVE', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid booking status.' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(bookingId, req.user.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or access denied.' });
    }

    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, bookingId);

    // If trip completed or cancelled, make vehicle available again
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      db.prepare("UPDATE vehicles SET availability_status = 'AVAILABLE' WHERE id = ?").run(booking.vehicle_id);
    } else if (status === 'ACTIVE') {
      db.prepare("UPDATE vehicles SET availability_status = 'BOOKED' WHERE id = ?").run(booking.vehicle_id);
    }

    res.json({
      success: true,
      message: `Booking status updated to ${status}`,
      status
    });
  } catch (err) {
    console.error('Update booking status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update booking status.' });
  }
});

// 5. GET OWNER'S BANK / UPI PAYOUT DETAILS
router.get('/bank-details', (req, res) => {
  try {
    let details = db.prepare('SELECT * FROM owner_bank_details WHERE owner_id = ?').get(req.user.id);

    if (!details) {
      db.prepare(`
        INSERT INTO owner_bank_details (owner_id, account_holder_name, account_number_masked, ifsc_code, bank_name, upi_id)
        VALUES (?, ?, '•••• •••• •••• 0000', 'HDFC0001243', 'HDFC Bank', '')
      `).run(req.user.id, req.user.name);
      details = db.prepare('SELECT * FROM owner_bank_details WHERE owner_id = ?').get(req.user.id);
    }

    res.json({
      success: true,
      bankDetails: details
    });
  } catch (err) {
    console.error('Bank details fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to load payout bank details.' });
  }
});

// 6. UPDATE OWNER'S BANK / UPI PAYOUT DETAILS
router.put('/bank-details', (req, res) => {
  try {
    const { accountHolderName, accountNumber, ifscCode, bankName, upiId } = req.body;

    if (!accountHolderName || !ifscCode || !bankName) {
      return res.status(400).json({ success: false, message: 'Account holder name, IFSC code, and bank name are required.' });
    }

    // Securely mask bank account number before storage
    let maskedAccount = maskBankAccount(accountNumber);
    if (!maskedAccount || maskedAccount === '•••• •••• ••••') {
      // If user didn't change account number, keep existing
      const existing = db.prepare('SELECT account_number_masked FROM owner_bank_details WHERE owner_id = ?').get(req.user.id);
      maskedAccount = existing ? existing.account_number_masked : '•••• •••• •••• 1234';
    }

    const cleanIFSC = ifscCode.trim().toUpperCase();
    const cleanUpi = upiId ? upiId.trim().toLowerCase() : '';

    const existing = db.prepare('SELECT id FROM owner_bank_details WHERE owner_id = ?').get(req.user.id);

    if (existing) {
      db.prepare(`
        UPDATE owner_bank_details
        SET account_holder_name = ?,
            account_number_masked = ?,
            ifsc_code = ?,
            bank_name = ?,
            upi_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE owner_id = ?
      `).run(accountHolderName.trim(), maskedAccount, cleanIFSC, bankName.trim(), cleanUpi, req.user.id);
    } else {
      db.prepare(`
        INSERT INTO owner_bank_details (owner_id, account_holder_name, account_number_masked, ifsc_code, bank_name, upi_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.user.id, accountHolderName.trim(), maskedAccount, cleanIFSC, bankName.trim(), cleanUpi);
    }

    const updated = db.prepare('SELECT * FROM owner_bank_details WHERE owner_id = ?').get(req.user.id);

    res.json({
      success: true,
      message: 'Bank and UPI payout details updated securely!',
      bankDetails: updated
    });
  } catch (err) {
    console.error('Update bank details error:', err);
    res.status(500).json({ success: false, message: 'Failed to update payout details.' });
  }
});

// 7. GET OWNER EARNINGS CHART DATA
router.get('/earnings-chart', (req, res) => {
  try {
    const chartData = [
      { month: 'May', gross: 14200, net: 12780, trips: 5 },
      { month: 'Jun', gross: 18500, net: 16650, trips: 7 },
      { month: 'Jul', gross: 24000, net: 21600, trips: 9 },
      { month: 'Aug', gross: 31200, net: 28080, trips: 12 },
      { month: 'Sep', gross: 28900, net: 26010, trips: 10 },
      { month: 'Oct', gross: 38400, net: 34560, trips: 14 }
    ];

    res.json({
      success: true,
      chartData
    });
  } catch (err) {
    console.error('Earnings chart error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch earnings chart data.' });
  }
});

module.exports = router;

