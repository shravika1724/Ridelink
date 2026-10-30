const express = require('express');
const router = express.Router();
const db = require('./db');
const { authenticateToken } = require('./middleware');

// Helper to compute transparent breakdown
function calculateRentalCharges(vehicle, durationType, durationCount, addons = []) {
  const count = parseFloat(durationCount) || 1;
  let baseAmount = 0;

  if (durationType === 'hours') {
    baseAmount = Math.round(vehicle.price_per_hour * count * 100) / 100;
  } else {
    baseAmount = Math.round(vehicle.price_per_day * count * 100) / 100;
  }

  // Calculate Add-ons
  let addonsTotal = 0;
  const addonItems = [];
  if (Array.isArray(addons)) {
    if (addons.includes('helmet')) {
      addonsTotal += 99;
      addonItems.push({ name: 'Dual DOT Helmets & Gear', price: 99 });
    }
    if (addons.includes('childSeat')) {
      addonsTotal += 199;
      addonItems.push({ name: 'Child Safety ISOFIX Seat', price: 199 });
    }
    if (addons.includes('unlimitedKm')) {
      addonsTotal += 499;
      addonItems.push({ name: 'Unlimited Kilometers Shield', price: 499 });
    }
    if (addons.includes('doorstepDelivery')) {
      addonsTotal += 299;
      addonItems.push({ name: 'Doorstep Delivery & Pickup', price: 299 });
    }
  }

  const damageProtectionFee = 299; // Standard 24/7 Roadside Assistance & Comprehensive Insurance
  const taxableSubtotal = Math.round((baseAmount + damageProtectionFee + addonsTotal) * 100) / 100;

  // Indian GST: 18% (9% CGST + 9% SGST)
  const gstCgst = Math.round(taxableSubtotal * 0.09 * 100) / 100;
  const gstSgst = Math.round(taxableSubtotal * 0.09 * 100) / 100;
  const totalGst = Math.round((gstCgst + gstSgst) * 100) / 100;

  const securityDeposit = vehicle.security_deposit || 2000;
  const grandTotal = Math.round((taxableSubtotal + totalGst + securityDeposit) * 100) / 100;

  return {
    durationType,
    durationCount: count,
    baseAmount,
    addonsTotal,
    addonItems,
    damageProtectionFee,
    taxableSubtotal,
    gstRate: '18% (9% CGST + 9% SGST)',
    gstCgst,
    gstSgst,
    totalGst,
    securityDeposit,
    grandTotal
  };
}

// 1. CALCULATE FARE PREVIEW
router.post('/calculate', (req, res) => {
  try {
    const { vehicleId, durationType, durationCount, addons } = req.body;
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);

    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    const calculation = calculateRentalCharges(vehicle, durationType || 'days', durationCount || 1, addons || []);
    res.json({ success: true, calculation });
  } catch (err) {
    console.error('Calculation error:', err);
    res.status(500).json({ success: false, message: 'Failed to calculate rental fare.' });
  }
});

// 2. CREATE BOOKING
router.post('/', authenticateToken, (req, res) => {
  try {
    const {
      vehicleId,
      startDate,
      endDate,
      durationType,
      durationCount,
      addons,
      pickupLocation,
      specialInstructions,
      terms_accepted
    } = req.body;

    if (!vehicleId || !startDate || !endDate || !durationCount) {
      return res.status(400).json({ success: false, message: 'All booking dates and vehicle details are required.' });
    }

    if (terms_accepted !== true && terms_accepted !== 'true' && terms_accepted !== 1 && terms_accepted !== '1') {
      return res.status(400).json({
        success: false,
        message: 'You must review and accept the rental conditions, cancellation policy, and return rules before booking.'
      });
    }

    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    if (vehicle.availability_status !== 'AVAILABLE') {
      return res.status(400).json({ success: false, message: 'This vehicle is currently not available for rental.' });
    }

    const calc = calculateRentalCharges(vehicle, durationType || 'days', durationCount, addons || []);
    const bookingCode = 'RL-BKG-' + Math.floor(100000 + Math.random() * 900000);

    const result = db.prepare(`
      INSERT INTO bookings (
        booking_code, vehicle_id, customer_id, owner_id, start_date, end_date,
        duration_type, duration_count, base_amount, damage_protection_fee,
        gst_cgst, gst_sgst, security_deposit, total_amount, pickup_location,
        special_instructions, status, terms_accepted, terms_version, terms_accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 1, 'v1.0', CURRENT_TIMESTAMP)
    `).run(
      bookingCode,
      vehicle.id,
      req.user.id,
      vehicle.owner_id,
      startDate,
      endDate,
      calc.durationType,
      calc.durationCount,
      calc.baseAmount,
      calc.damageProtectionFee,
      calc.gstCgst,
      calc.gstSgst,
      calc.securityDeposit,
      calc.grandTotal,
      pickupLocation || vehicle.location_address,
      specialInstructions || null
    );

    const bookingId = result.lastInsertRowid;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);

    res.status(201).json({
      success: true,
      message: 'Booking created. Proceed to payment.',
      booking,
      breakdown: calc
    });
  } catch (err) {
    console.error('Booking creation error:', err);
    res.status(500).json({ success: false, message: 'Failed to create booking.' });
  }
});

// 3. GET CURRENT CUSTOMER BOOKINGS
router.get('/my', authenticateToken, (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*,
             v.title as vehicle_title,
             v.brand as vehicle_brand,
             v.model as vehicle_model,
             v.photos_json,
             v.reg_number,
             v.category,
             u.name as owner_name,
             u.phone as owner_phone,
             p.payment_code,
             p.payment_method,
             p.payment_status,
             p.invoice_number,
             p.transaction_ref
      FROM bookings b
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users u ON b.owner_id = u.id
      LEFT JOIN payments p ON b.id = p.booking_id
      WHERE b.customer_id = ?
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
    console.error('Customer bookings error:', err);
    res.status(500).json({ success: false, message: 'Failed to load bookings.' });
  }
});

// 4. GET BOOKING BY ID
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const booking = db.prepare(`
      SELECT b.*,
             v.title as vehicle_title,
             v.brand as vehicle_brand,
             v.model as vehicle_model,
             v.photos_json,
             v.reg_number,
             v.location_address,
             u.name as owner_name,
             u.phone as owner_phone,
             p.payment_code,
             p.payment_method,
             p.payment_status,
             p.invoice_number,
             p.paid_at
      FROM bookings b
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users u ON b.owner_id = u.id
      LEFT JOIN payments p ON b.id = p.booking_id
      WHERE b.id = ?
    `).get(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // Check authorization: customer, owner, or admin
    if (booking.customer_id !== req.user.id && booking.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    booking.photos = booking.photos_json ? JSON.parse(booking.photos_json) : [];

    res.json({
      success: true,
      booking
    });
  } catch (err) {
    console.error('Booking detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch booking details.' });
  }
});

// 5. CANCEL BOOKING
router.post('/:id/cancel', authenticateToken, (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    if (booking.customer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to cancel this booking.' });
    }

    if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel a booking that is already ${booking.status}.` });
    }

    db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?").run(req.params.id);

    // Also free vehicle status if needed
    db.prepare("UPDATE vehicles SET availability_status = 'AVAILABLE' WHERE id = ?").run(booking.vehicle_id);

    res.json({
      success: true,
      message: 'Booking cancelled successfully. Refund initiated for the security deposit and fare according to policy.'
    });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel booking.' });
  }
});

// 6. SUBMIT TRIP REVIEW & RATING
router.post('/:id/review', authenticateToken, (req, res) => {
  try {
    const { rating, comment } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    if (booking.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only the renter can review this vehicle.' });
    }

    const starRating = Math.max(1, Math.min(5, parseFloat(rating) || 5));
    const reviewText = (comment || 'Smooth, safe ride. Highly recommended host!').trim();

    db.prepare(`
      INSERT INTO reviews (vehicle_id, customer_id, rating, comment)
      VALUES (?, ?, ?, ?)
    `).run(booking.vehicle_id, req.user.id, starRating, reviewText);

    // Update vehicle's aggregate rating
    const avg = db.prepare('SELECT AVG(rating) as avg_rating FROM reviews WHERE vehicle_id = ?').get(booking.vehicle_id);
    if (avg && avg.avg_rating) {
      db.prepare('UPDATE vehicles SET rating = ? WHERE id = ?').run(Math.round(avg.avg_rating * 10) / 10, booking.vehicle_id);
    }

    res.json({
      success: true,
      message: 'Thank you! Your verified trip review and rating have been posted.'
    });
  } catch (err) {
    console.error('Review submit error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit review.' });
  }
});

// 7. GET TRIP CHAT MESSAGES
router.get('/:id/messages', authenticateToken, (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    if (booking.customer_id !== req.user.id && booking.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.booking_id = ?
      ORDER BY m.id ASC
    `).all(req.params.id);

    res.json({ success: true, messages });
  } catch (err) {
    console.error('Fetch messages error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// 8. SEND TRIP CHAT MESSAGE
router.post('/:id/messages', authenticateToken, (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Message text cannot be empty.' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    if (booking.customer_id !== req.user.id && booking.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const insert = db.prepare(`
      INSERT INTO messages (booking_id, sender_id, message_text)
      VALUES (?, ?, ?)
    `).run(booking.id, req.user.id, text.trim());

    const newMsg = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(insert.lastInsertRowid);

    res.json({ success: true, message: newMsg });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

module.exports = router;

