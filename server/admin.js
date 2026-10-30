const express = require('express');
const router = express.Router();
const db = require('./db');
const { authenticateToken, requireRole } = require('./middleware');

// Protect all admin routes
router.use(authenticateToken);
router.use(requireRole('admin'));

// 1. ADMIN PLATFORM METRICS
router.get('/stats', (req, res) => {
  try {
    const userCounts = db.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'customer' THEN 1 ELSE 0 END) as total_customers,
        SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) as total_owners,
        SUM(CASE WHEN kyc_status = 'PENDING' THEN 1 ELSE 0 END) as pending_kyc
      FROM users
    `).get();

    const vehicleCounts = db.prepare(`
      SELECT
        COUNT(*) as total_vehicles,
        SUM(CASE WHEN is_approved = 1 THEN 1 ELSE 0 END) as approved_vehicles,
        SUM(CASE WHEN is_approved = 0 THEN 1 ELSE 0 END) as pending_vehicles,
        SUM(CASE WHEN availability_status = 'AVAILABLE' THEN 1 ELSE 0 END) as active_available
      FROM vehicles
    `).get();

    const financialStats = db.prepare(`
      SELECT
        COUNT(*) as total_bookings,
        SUM(CASE WHEN status IN ('CONFIRMED', 'COMPLETED') THEN 1 ELSE 0 END) as successful_bookings,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'COMPLETED') THEN total_amount ELSE 0 END), 0) as gmv,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'COMPLETED') THEN (base_amount * 0.10) ELSE 0 END), 0) as platform_revenue
      FROM bookings
    `).get();

    res.json({
      success: true,
      stats: {
        totalUsers: userCounts.total_users || 0,
        totalCustomers: userCounts.total_customers || 0,
        totalOwners: userCounts.total_owners || 0,
        pendingKycCount: userCounts.pending_kyc || 0,
        totalVehicles: vehicleCounts.total_vehicles || 0,
        approvedVehicles: vehicleCounts.approved_vehicles || 0,
        pendingVehicles: vehicleCounts.pending_vehicles || 0,
        activeAvailableVehicles: vehicleCounts.active_available || 0,
        totalBookings: financialStats.total_bookings || 0,
        successfulBookings: financialStats.successful_bookings || 0,
        gmv: Math.round(financialStats.gmv * 100) / 100,
        platformRevenue: Math.round(financialStats.platform_revenue * 100) / 100
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch platform metrics.' });
  }
});

// 2. LIST USERS
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, email, phone, role, avatar, is_phone_verified,
             kyc_status, dl_number_masked, aadhaar_number_masked, kyc_notes, created_at,
             (SELECT COUNT(*) FROM vehicles WHERE owner_id = users.id) as vehicle_count,
             (SELECT COUNT(*) FROM bookings WHERE customer_id = users.id) as booking_count
      FROM users
      ORDER BY id DESC
    `).all();

    res.json({ success: true, users });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch user directory.' });
  }
});

// 3. KYC VERIFICATION QUEUE
router.get('/kyc-queue', (req, res) => {
  try {
    const queue = db.prepare(`
      SELECT id, name, email, phone, role, avatar, kyc_status,
             dl_number_masked, dl_doc_name, aadhaar_number_masked,
             aadhaar_doc_name, kyc_notes, created_at
      FROM users
      WHERE dl_number_masked IS NOT NULL OR aadhaar_number_masked IS NOT NULL
      ORDER BY CASE WHEN kyc_status = 'PENDING' THEN 1 ELSE 2 END, id DESC
    `).all();

    res.json({ success: true, queue });
  } catch (err) {
    console.error('KYC queue error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch KYC queue.' });
  }
});

// 4. APPROVE OR REJECT KYC
router.patch('/kyc/:userId/verify', (req, res) => {
  try {
    const { status, notes } = req.body;
    const userId = req.params.userId;

    if (!['VERIFIED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC status.' });
    }

    db.prepare(`
      UPDATE users
      SET kyc_status = ?,
          kyc_notes = ?
      WHERE id = ?
    `).run(status, notes || (status === 'VERIFIED' ? 'Approved by Admin' : 'Documents unclear'), userId);

    res.json({
      success: true,
      message: `User KYC status updated to ${status}.`
    });
  } catch (err) {
    console.error('KYC decision error:', err);
    res.status(500).json({ success: false, message: 'Failed to update KYC status.' });
  }
});

// 5. ALL VEHICLES MODERATION
router.get('/vehicles', (req, res) => {
  try {
    const vehicles = db.prepare(`
      SELECT v.*, u.name as owner_name, u.email as owner_email, u.phone as owner_phone
      FROM vehicles v
      JOIN users u ON v.owner_id = u.id
      ORDER BY v.id DESC
    `).all();

    const formatted = vehicles.map(v => ({
      ...v,
      features: v.features_json ? JSON.parse(v.features_json) : [],
      photos: v.photos_json ? JSON.parse(v.photos_json) : []
    }));

    res.json({ success: true, vehicles: formatted });
  } catch (err) {
    console.error('Admin vehicles error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch vehicles.' });
  }
});

// 6. APPROVE / SUSPEND VEHICLE
router.patch('/vehicles/:id/approval', (req, res) => {
  try {
    const { isApproved } = req.body;
    db.prepare('UPDATE vehicles SET is_approved = ? WHERE id = ?').run(isApproved ? 1 : 0, req.params.id);

    res.json({
      success: true,
      message: `Vehicle ${isApproved ? 'approved and made live' : 'unlisted/suspended'}.`
    });
  } catch (err) {
    console.error('Vehicle approval error:', err);
    res.status(500).json({ success: false, message: 'Failed to toggle vehicle approval.' });
  }
});

// 7. ALL BOOKINGS & AUDIT LOG
router.get('/bookings', (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*,
             v.title as vehicle_title,
             v.reg_number,
             c.name as customer_name,
             c.phone as customer_phone,
             u.name as owner_name,
             p.payment_code,
             p.payment_method,
             p.payment_status,
             p.invoice_number,
             p.transaction_ref
      FROM bookings b
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users c ON b.customer_id = c.id
      JOIN users u ON b.owner_id = u.id
      LEFT JOIN payments p ON b.id = p.booking_id
      ORDER BY b.id DESC
    `).all();

    res.json({ success: true, bookings });
  } catch (err) {
    console.error('Admin bookings audit error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings audit.' });
  }
});

module.exports = router;
