const express = require('express');
const router = express.Router();
const db = require('./db');
const { authenticateToken, requireRole } = require('./middleware');

// 1. GET ALL VEHICLES (Marketplace with filters & search)
router.get('/', (req, res) => {
  try {
    const {
      search,
      category,
      city,
      fuel,
      transmission,
      minPrice,
      maxPrice,
      sort
    } = req.query;

    let sql = `
      SELECT v.*, u.name as owner_name, u.avatar as owner_avatar, u.kyc_status as owner_kyc_status
      FROM vehicles v
      JOIN users u ON v.owner_id = u.id
      WHERE v.is_approved = 1 AND v.availability_status != 'MAINTENANCE'
    `;
    const params = [];

    if (search) {
      sql += ` AND (v.title LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR v.location_city LIKE ? OR v.location_address LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    if (category && category !== 'all') {
      sql += ` AND v.category = ?`;
      params.push(category);
    }

    if (city && city !== 'all') {
      sql += ` AND LOWER(v.location_city) = LOWER(?)`;
      params.push(city);
    }

    if (fuel && fuel !== 'all') {
      sql += ` AND v.fuel_type LIKE ?`;
      params.push(`%${fuel}%`);
    }

    if (transmission && transmission !== 'all') {
      sql += ` AND v.transmission = ?`;
      params.push(transmission);
    }

    if (minPrice) {
      sql += ` AND v.price_per_day >= ?`;
      params.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      sql += ` AND v.price_per_day <= ?`;
      params.push(parseFloat(maxPrice));
    }

    // Sorting
    if (sort === 'price_asc') {
      sql += ` ORDER BY v.price_per_day ASC`;
    } else if (sort === 'price_desc') {
      sql += ` ORDER BY v.price_per_day DESC`;
    } else if (sort === 'rating') {
      sql += ` ORDER BY v.rating DESC`;
    } else {
      sql += ` ORDER BY v.id DESC`;
    }

    const rows = db.prepare(sql).all(...params);

    const vehicles = rows.map(v => ({
      ...v,
      features: v.features_json ? JSON.parse(v.features_json) : [],
      photos: v.photos_json ? JSON.parse(v.photos_json) : []
    }));

    res.json({
      success: true,
      count: vehicles.length,
      vehicles
    });
  } catch (err) {
    console.error('Fetch vehicles error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch vehicles.' });
  }
});

// 2. GET SINGLE VEHICLE DETAILS
router.get('/:id', (req, res) => {
  try {
    const vehicle = db.prepare(`
      SELECT v.*, u.name as owner_name, u.avatar as owner_avatar, u.kyc_status as owner_kyc_status, u.created_at as owner_joined
      FROM vehicles v
      JOIN users u ON v.owner_id = u.id
      WHERE v.id = ?
    `).get(req.params.id);

    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    // Parse JSON
    vehicle.features = vehicle.features_json ? JSON.parse(vehicle.features_json) : [];
    vehicle.photos = vehicle.photos_json ? JSON.parse(vehicle.photos_json) : [];

    // Fetch reviews
    const reviews = db.prepare(`
      SELECT r.*, u.name as customer_name, u.avatar as customer_avatar
      FROM reviews r
      JOIN users u ON r.customer_id = u.id
      WHERE r.vehicle_id = ?
      ORDER BY r.created_at DESC
    `).all(req.params.id);

    vehicle.reviews = reviews;

    res.json({
      success: true,
      vehicle
    });
  } catch (err) {
    console.error('Vehicle detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load vehicle details.' });
  }
});

// 3. CREATE VEHICLE (Owner or Admin only)
router.post('/', authenticateToken, requireRole('owner'), (req, res) => {
  try {
    const {
      title,
      brand,
      model,
      year,
      category,
      reg_number,
      location_city,
      location_address,
      price_per_day,
      price_per_hour,
      security_deposit,
      fuel_type,
      transmission,
      seating,
      mileage,
      description,
      features,
      photos,
      owner_declaration
    } = req.body;

    if (!title || !brand || !model || !reg_number || !location_city || !price_per_day) {
      return res.status(400).json({ success: false, message: 'Please provide all required vehicle details.' });
    }

    if (owner_declaration !== true && owner_declaration !== 'true' && owner_declaration !== 1 && owner_declaration !== '1') {
      return res.status(400).json({
        success: false,
        message: 'You must confirm that you are authorized to list this vehicle and that all vehicle details are accurate.'
      });
    }

    // Check duplicate reg number
    const existing = db.prepare('SELECT id FROM vehicles WHERE reg_number = ?').get(reg_number.trim().toUpperCase());
    if (existing) {
      return res.status(409).json({ success: false, message: 'A vehicle with this registration number is already registered.' });
    }

    // Prepare photos (fallback if empty)
    let photoList = Array.isArray(photos) && photos.length > 0 ? photos : ['/assets/vehicle-ev-suv.jpg'];
    let featuresList = Array.isArray(features) ? features : ['GPS Tracking', 'AC', 'Bluetooth Audio', 'Airbags'];

    const insertResult = db.prepare(`
      INSERT INTO vehicles (
        owner_id, title, brand, model, year, category, reg_number,
        location_city, location_address, price_per_day, price_per_hour,
        security_deposit, fuel_type, transmission, seating, mileage,
        description, features_json, photos_json, availability_status, is_approved, rating,
        owner_declaration_accepted, declaration_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', 1, 5.0, 1, CURRENT_TIMESTAMP)
    `).run(
      req.user.id,
      title.trim(),
      brand.trim(),
      model.trim(),
      parseInt(year) || new Date().getFullYear(),
      category || 'SUV',
      reg_number.trim().toUpperCase(),
      location_city.trim(),
      location_address ? location_address.trim() : location_city.trim(),
      parseFloat(price_per_day),
      parseFloat(price_per_hour) || Math.round(price_per_day / 12),
      parseFloat(security_deposit) || 2000,
      fuel_type || 'Petrol',
      transmission || 'Manual',
      parseInt(seating) || 5,
      mileage || '16 km/l',
      description || 'Well maintained, sanitized and ready for rent.',
      JSON.stringify(featuresList),
      JSON.stringify(photoList)
    );

    const newVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(insertResult.lastInsertRowid);
    newVehicle.features = JSON.parse(newVehicle.features_json);
    newVehicle.photos = JSON.parse(newVehicle.photos_json);

    res.status(201).json({
      success: true,
      message: 'Vehicle listed successfully!',
      vehicle: newVehicle
    });
  } catch (err) {
    console.error('Create vehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to create vehicle listing.' });
  }
});

// 4. UPDATE VEHICLE
router.put('/:id', authenticateToken, requireRole('owner'), (req, res) => {
  try {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    if (vehicle.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You are not authorized to edit this vehicle.' });
    }

    const {
      title,
      price_per_day,
      price_per_hour,
      security_deposit,
      location_city,
      location_address,
      description,
      availability_status
    } = req.body;

    db.prepare(`
      UPDATE vehicles
      SET title = COALESCE(?, title),
          price_per_day = COALESCE(?, price_per_day),
          price_per_hour = COALESCE(?, price_per_hour),
          security_deposit = COALESCE(?, security_deposit),
          location_city = COALESCE(?, location_city),
          location_address = COALESCE(?, location_address),
          description = COALESCE(?, description),
          availability_status = COALESCE(?, availability_status)
      WHERE id = ?
    `).run(
      title,
      price_per_day ? parseFloat(price_per_day) : null,
      price_per_hour ? parseFloat(price_per_hour) : null,
      security_deposit ? parseFloat(security_deposit) : null,
      location_city,
      location_address,
      description,
      availability_status,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);

    res.json({
      success: true,
      message: 'Vehicle updated successfully!',
      vehicle: updated
    });
  } catch (err) {
    console.error('Update vehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to update vehicle.' });
  }
});

// 5. TOGGLE AVAILABILITY STATUS
router.patch('/:id/status', authenticateToken, requireRole('owner'), (req, res) => {
  try {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    if (vehicle.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const { status } = req.body;
    if (!['AVAILABLE', 'BOOKED', 'MAINTENANCE'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    db.prepare('UPDATE vehicles SET availability_status = ? WHERE id = ?').run(status, req.params.id);

    res.json({
      success: true,
      message: `Vehicle status changed to ${status}`,
      status
    });
  } catch (err) {
    console.error('Status patch error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status.' });
  }
});

// 6. DELETE VEHICLE
router.delete('/:id', authenticateToken, requireRole('owner'), (req, res) => {
  try {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    if (vehicle.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    // Check if there are active bookings
    const activeBookings = db.prepare(`
      SELECT id FROM bookings WHERE vehicle_id = ? AND status IN ('PENDING', 'CONFIRMED', 'ACTIVE')
    `).all(req.params.id);

    if (activeBookings.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vehicle with active or upcoming bookings. Complete or cancel trips first.'
      });
    }

    db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);

    res.json({
      success: true,
      message: 'Vehicle removed successfully.'
    });
  } catch (err) {
    console.error('Delete vehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete vehicle.' });
  }
});

module.exports = router;
