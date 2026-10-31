const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const os = require('os');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let dbPath;

if (isVercel) {
  const tempDir = os.tmpdir();
  const tmpDbPath = path.join(tempDir, 'ridelink.sqlite');
  const sourceDbPath = path.join(__dirname, 'ridelink.sqlite');

  if (!fs.existsSync(tmpDbPath)) {
    try {
      if (fs.existsSync(sourceDbPath)) {
        fs.copyFileSync(sourceDbPath, tmpDbPath);

        const sourceWal = path.join(__dirname, 'ridelink.sqlite-wal');
        const tmpWal = path.join(tempDir, 'ridelink.sqlite-wal');
        if (fs.existsSync(sourceWal)) {
          try { fs.copyFileSync(sourceWal, tmpWal); } catch (_) {}
        }

        const sourceShm = path.join(__dirname, 'ridelink.sqlite-shm');
        const tmpShm = path.join(tempDir, 'ridelink.sqlite-shm');
        if (fs.existsSync(sourceShm)) {
          try { fs.copyFileSync(sourceShm, tmpShm); } catch (_) {}
        }

        console.log('✅ Copied seed SQLite database to ' + tmpDbPath);
      }
    } catch (err) {
      console.warn('⚠️ Could not copy seed sqlite database to temp directory:', err.message);
    }
  }
  dbPath = tmpDbPath;
} else {
  dbPath = path.join(__dirname, 'ridelink.sqlite');
}

const db = new Database(dbPath);

// Enable foreign keys and journal mode (fallback to DELETE if WAL is unsupported in environment)
try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  try { db.pragma('journal_mode = DELETE'); } catch (_) {}
}
db.pragma('foreign_keys = ON');

function initDatabase() {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('customer', 'owner', 'admin')),
      avatar TEXT,
      is_phone_verified INTEGER DEFAULT 1,
      kyc_status TEXT DEFAULT 'PENDING' CHECK(kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'NOT_SUBMITTED')),
      dl_number_masked TEXT,
      dl_doc_name TEXT,
      aadhaar_number_masked TEXT,
      aadhaar_doc_name TEXT,
      kyc_notes TEXT,
      firebase_uid TEXT,
      terms_accepted INTEGER DEFAULT 1,
      terms_version TEXT DEFAULT 'v1.0',
      terms_accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS owner_bank_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL UNIQUE,
      account_holder_name TEXT NOT NULL,
      account_number_masked TEXT NOT NULL,
      ifsc_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      upi_id TEXT NOT NULL,
      is_verified INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('SUV', 'Sedan', 'Hatchback', 'Bike', 'Electric', 'Luxury')),
      reg_number TEXT NOT NULL UNIQUE,
      location_city TEXT NOT NULL,
      location_address TEXT NOT NULL,
      price_per_day REAL NOT NULL,
      price_per_hour REAL NOT NULL,
      security_deposit REAL DEFAULT 2000,
      fuel_type TEXT NOT NULL,
      transmission TEXT NOT NULL,
      seating INTEGER NOT NULL,
      mileage TEXT,
      description TEXT,
      features_json TEXT,
      photos_json TEXT,
      availability_status TEXT DEFAULT 'AVAILABLE' CHECK(availability_status IN ('AVAILABLE', 'BOOKED', 'MAINTENANCE')),
      is_approved INTEGER DEFAULT 1,
      rating REAL DEFAULT 4.8,
      trip_count INTEGER DEFAULT 0,
      owner_declaration_accepted INTEGER DEFAULT 1,
      declaration_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_code TEXT UNIQUE NOT NULL,
      vehicle_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      owner_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      duration_type TEXT DEFAULT 'days',
      duration_count REAL NOT NULL,
      base_amount REAL NOT NULL,
      damage_protection_fee REAL NOT NULL,
      gst_cgst REAL NOT NULL,
      gst_sgst REAL NOT NULL,
      security_deposit REAL NOT NULL,
      total_amount REAL NOT NULL,
      pickup_location TEXT NOT NULL,
      special_instructions TEXT,
      status TEXT DEFAULT 'CONFIRMED' CHECK(status IN ('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
      terms_accepted INTEGER DEFAULT 1,
      terms_version TEXT DEFAULT 'v1.0',
      terms_accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT,
      FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_code TEXT UNIQUE NOT NULL,
      booking_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('UPI', 'QR', 'CARD', 'NETBANKING')),
      payment_status TEXT DEFAULT 'SUCCESS' CHECK(payment_status IN ('SUCCESS', 'PENDING', 'FAILED')),
      transaction_ref TEXT NOT NULL,
      upi_id TEXT,
      card_last4 TEXT,
      bank_name TEXT,
      invoice_number TEXT NOT NULL UNIQUE,
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
      FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      rating REAL NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Safely add firebase_uid column if not exists (migration for existing databases)
  try {
    db.exec(`ALTER TABLE users ADD COLUMN firebase_uid TEXT`);
    console.log('✅ Migrated: added firebase_uid column to users table');
  } catch (e) {
    // Column already exists — ignore
  }

  // Safely add terms and conditions columns to users table
  try { db.exec(`ALTER TABLE users ADD COLUMN terms_accepted INTEGER DEFAULT 1`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN terms_version TEXT DEFAULT 'v1.0'`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME`); } catch (e) {}

  // Safely add terms acceptance columns to bookings table
  try { db.exec(`ALTER TABLE bookings ADD COLUMN terms_accepted INTEGER DEFAULT 1`); } catch (e) {}
  try { db.exec(`ALTER TABLE bookings ADD COLUMN terms_version TEXT DEFAULT 'v1.0'`); } catch (e) {}
  try { db.exec(`ALTER TABLE bookings ADD COLUMN terms_accepted_at DATETIME`); } catch (e) {}

  // Safely add owner declaration columns to vehicles table
  try { db.exec(`ALTER TABLE vehicles ADD COLUMN owner_declaration_accepted INTEGER DEFAULT 1`); } catch (e) {}
  try { db.exec(`ALTER TABLE vehicles ADD COLUMN declaration_timestamp DATETIME`); } catch (e) {}

  // Seed default data if users table is empty
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    seedDatabase();
  }
}

function seedDatabase() {
  console.log('🌱 Seeding initial database data...');
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('password123', salt);
  const adminPasswordHash = bcrypt.hashSync('admin123', salt);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role, avatar, is_phone_verified, kyc_status, dl_number_masked, dl_doc_name, aadhaar_number_masked, aadhaar_doc_name, kyc_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. Customer
  const customerId = insertUser.run(
    'Rahul Sharma',
    'rahul@customer.com',
    '+91 98765 43210',
    passwordHash,
    'customer',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
    1,
    'VERIFIED',
    'DL-04-2019-XXXX-4819',
    'rahul_driving_licence.pdf',
    'XXXX-XXXX-7842',
    'rahul_aadhaar_card.pdf',
    'Verified via UIDAI & MoRTH sandbox API'
  ).lastInsertRowid;

  // 2. Vehicle Owner
  const ownerId = insertUser.run(
    'Priya Patel',
    'priya@owner.com',
    '+91 98111 22334',
    passwordHash,
    'owner',
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80',
    1,
    'VERIFIED',
    'DL-12-2018-XXXX-5102',
    'priya_dl_document.pdf',
    'XXXX-XXXX-9018',
    'priya_aadhaar_verified.pdf',
    'Fleet owner verified'
  ).lastInsertRowid;

  // 3. Admin
  insertUser.run(
    'RideLink Operations Admin',
    'admin@ridelink.com',
    '+91 99000 11223',
    adminPasswordHash,
    'admin',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80',
    1,
    'VERIFIED',
    'DL-07-2015-XXXX-1100',
    'admin_dl.pdf',
    'XXXX-XXXX-1001',
    'admin_aadhaar.pdf',
    'System administrator'
  );

  // Bank details for Priya Patel
  db.prepare(`
    INSERT INTO owner_bank_details (owner_id, account_holder_name, account_number_masked, ifsc_code, bank_name, upi_id, is_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    ownerId,
    'Priya Patel',
    '•••• •••• •••• 8842',
    'HDFC0001243',
    'HDFC Bank - Indiranagar Branch',
    'priya.patel@okhdfcbank',
    1
  );

  // 8 Seed Vehicles
  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (owner_id, title, brand, model, year, category, reg_number, location_city, location_address, price_per_day, price_per_hour, security_deposit, fuel_type, transmission, seating, mileage, description, features_json, photos_json, availability_status, is_approved, rating, trip_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const vehiclesData = [
    {
      owner_id: ownerId,
      title: 'Tata Nexon EV Max Prime - Long Range SUV',
      brand: 'Tata',
      model: 'Nexon EV Max',
      year: 2024,
      category: 'Electric',
      reg_number: 'KA-03-EV-9821',
      location_city: 'Bangalore',
      location_address: '100ft Road, Indiranagar, Bengaluru, Karnataka 560038',
      price_per_day: 2800,
      price_per_hour: 220,
      security_deposit: 3000,
      fuel_type: 'Electric (437 km range)',
      transmission: 'Automatic',
      seating: 5,
      mileage: '437 km / Full Charge',
      description: 'Experience ultra-smooth electric driving with the Nexon EV Max. Comes with 7.2kW fast AC home charger adapter, ventilated front seats, wireless smartphone charging, and 360-degree cameras. Fully sanitized before every trip.',
      features_json: JSON.stringify(['Fast DC Charging Supported', 'Sunroof', 'Air Purifier', 'Android Auto / Apple CarPlay', 'Connected Car Telematics', 'Cruise Control']),
      photos_json: JSON.stringify([
        '/assets/vehicle-ev-suv.jpg',
        'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=800&q=80'
      ]),
      availability_status: 'AVAILABLE',
      is_approved: 1,
      rating: 4.95,
      trip_count: 24
    },
    {
      owner_id: ownerId,
      title: 'Mahindra Thar 4x4 Hard Top Adventure Edition',
      brand: 'Mahindra',
      model: 'Thar LX 4x4',
      year: 2023,
      category: 'SUV',
      reg_number: 'MH-02-TH-4412',
      location_city: 'Mumbai',
      location_address: 'Linking Road, Bandra West, Mumbai, Maharashtra 400050',
      price_per_day: 3600,
      price_per_hour: 290,
      security_deposit: 4000,
      fuel_type: 'Diesel Turbo',
      transmission: 'Automatic',
      seating: 4,
      mileage: '15.2 km/l',
      description: 'Conquer both city traffic and western ghats highway roadtrips in pure style. Fitted with BF Goodrich all-terrain tires, roof luggage rack, winch, and touch infotainment. Perfect for weekend getaways to Lonavala, Alibaug, and Goa.',
      features_json: JSON.stringify(['4x4 Shift-on-the-fly', 'Off-road Adventure Kit', 'Roof Cargo Rack', 'Touchscreen Infotainment', 'Tyre Pressure Monitoring', 'Roll Cage Safety']),
      photos_json: JSON.stringify([
        '/assets/vehicle-thar-4x4.jpg',
        'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80'
      ]),
      availability_status: 'AVAILABLE',
      is_approved: 1,
      rating: 4.88,
      trip_count: 31
    },
    {
      owner_id: ownerId,
      title: 'Mercedes-Benz E-Class Executive Limousine',
      brand: 'Mercedes-Benz',
      model: 'E 220d Exclusive',
      year: 2024,
      category: 'Luxury',
      reg_number: 'DL-1C-MB-7788',
      location_city: 'Delhi NCR',
      location_address: 'Hospitality District, Aerocity, New Delhi 110037',
      price_per_day: 8500,
      price_per_hour: 750,
      security_deposit: 10000,
      fuel_type: 'Diesel Turbo',
      transmission: 'Automatic 9G-TRONIC',
      seating: 5,
      mileage: '16.5 km/l',
      description: 'First-class luxury travel for corporate executives, weddings, or VIP airport transfers. Chauffeur comfort reclining rear seats, Burmester 3D Surround Sound, dual panoramic sunroof, and airmatic suspension.',
      features_json: JSON.stringify(['Reclining Rear Executive Seats', 'Burmester Surround Audio', 'Panoramic Sunroof', 'Chilled Glovebox & Rear AC', '360 Parking Cameras', 'Full Leather Interior']),
      photos_json: JSON.stringify([
        '/assets/vehicle-luxury-sedan.jpg',
        'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=800&q=80'
      ]),
      availability_status: 'AVAILABLE',
      is_approved: 1,
      rating: 5.0,
      trip_count: 18
    },
    {
      owner_id: ownerId,
      title: 'Harley-Davidson Fat Bob 114 Cruiser',
      brand: 'Harley-Davidson',
      model: 'Fat Bob 114',
      year: 2023,
      category: 'Bike',
      reg_number: 'GA-03-HD-0007',
      location_city: 'Goa',
      location_address: 'Anjuna Coastal Highway, North Goa, Goa 403509',
      price_per_day: 2400,
      price_per_hour: 200,
      security_deposit: 3000,
      fuel_type: 'Petrol (Milwaukee-Eight 114)',
      transmission: 'Manual 6-Speed',
      seating: 2,
      mileage: '18 km/l',
      description: 'Pure muscle motorcycle built for coastal highway cruising. Comes equipped with dual Brembo front discs, inverted front forks, custom matte exhaust tone, and includes two sanitized DOT-certified helmets.',
      features_json: JSON.stringify(['2 DOT Certified Helmets Included', 'Custom Exhaust Sound', 'Keyless Ignition', 'Dual Channel ABS', 'USB Phone Charger', 'Pillion Backrest']),
      photos_json: JSON.stringify([
        '/assets/vehicle-sport-bike.jpg',
        'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=800&q=80'
      ]),
      availability_status: 'AVAILABLE',
      is_approved: 1,
      rating: 4.92,
      trip_count: 42
    },
    {
      owner_id: ownerId,
      title: 'Volkswagen Polo GT TSI Sport Edition',
      brand: 'Volkswagen',
      model: 'Polo GT TSI',
      year: 2022,
      category: 'Hatchback',
      reg_number: 'KA-05-GT-2391',
      location_city: 'Bangalore',
      location_address: 'Sony World Junction, Koramangala 4th Block, Bengaluru 560034',
      price_per_day: 1900,
      price_per_hour: 160,
      security_deposit: 2000,
      fuel_type: 'Petrol Turbo',
      transmission: 'Automatic DSG',
      seating: 5,
      mileage: '18.2 km/l',
      description: 'Zippy, nimble, and effortless to park in city traffic. Renowned German build quality with ESP traction control, paddle shifters, sport alloy wheels, and wireless music playback.',
      features_json: JSON.stringify(['Paddle Shifters', 'Electronic Stability Program', 'Cruise Control', 'Wireless Bluetooth', 'Touchscreen Infotainment', 'Reverse Sensors']),
      photos_json: JSON.stringify([
        '/assets/vehicle-hatchback.jpg',
        'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=800&q=80'
      ]),
      availability_status: 'AVAILABLE',
      is_approved: 1,
      rating: 4.86,
      trip_count: 38
    },
    {
      owner_id: ownerId,
      title: 'Hyundai Creta SX (O) Panoramic Sunroof',
      brand: 'Hyundai',
      model: 'Creta 1.5 SX(O)',
      year: 2024,
      category: 'SUV',
      reg_number: 'TS-09-CR-5511',
      location_city: 'Hyderabad',
      location_address: 'Mindspace IT Park, Hitec City, Hyderabad, Telangana 500081',
      price_per_day: 2700,
      price_per_hour: 230,
      security_deposit: 2500,
      fuel_type: 'Petrol',
      transmission: 'Automatic IVT',
      seating: 5,
      mileage: '17 km/l',
      description: 'Indias favorite family touring SUV. Loaded with Level 2 ADAS driver assist, voice-enabled panoramic sunroof, Bose 8-speaker sound, ventilated seats, and expansive boot space for 4 large suitcases.',
      features_json: JSON.stringify(['Panoramic Sunroof', 'Level 2 ADAS Safety', 'Bose Premium Audio', 'Ventilated Front Seats', 'Blind View Monitor', 'Electronic Parking Brake']),
      photos_json: JSON.stringify([
        '/assets/hero-banner.jpg',
        'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80'
      ]),
      availability_status: 'AVAILABLE',
      is_approved: 1,
      rating: 4.9,
      trip_count: 19
    }
  ];

  const vehicleIds = [];
  for (const v of vehiclesData) {
    const res = insertVehicle.run(
      v.owner_id, v.title, v.brand, v.model, v.year, v.category, v.reg_number,
      v.location_city, v.location_address, v.price_per_day, v.price_per_hour,
      v.security_deposit, v.fuel_type, v.transmission, v.seating, v.mileage,
      v.description, v.features_json, v.photos_json, v.availability_status,
      v.is_approved, v.rating, v.trip_count
    );
    vehicleIds.push(res.lastInsertRowid);
  }

  // Seed sample booking & payment for Rahul Sharma
  const bookingCode = 'RL-BKG-' + Math.floor(100000 + Math.random() * 900000);
  const paymentCode = 'RL-PAY-' + Math.floor(100000 + Math.random() * 900000);
  const invoiceNum = 'INV-2026-0084';

  const baseFare = 2800 * 2; // 2 days = 5600
  const damageProt = 299;
  const taxable = baseFare + damageProt; // 5899
  const cgst = Math.round(taxable * 0.09 * 100) / 100; // 530.91
  const sgst = Math.round(taxable * 0.09 * 100) / 100; // 530.91
  const secDeposit = 3000;
  const totalAmount = Math.round((taxable + cgst + sgst + secDeposit) * 100) / 100; // 9960.82

  const bookingRes = db.prepare(`
    INSERT INTO bookings (
      booking_code, vehicle_id, customer_id, owner_id, start_date, end_date,
      duration_type, duration_count, base_amount, damage_protection_fee,
      gst_cgst, gst_sgst, security_deposit, total_amount, pickup_location,
      special_instructions, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bookingCode, vehicleIds[0], customerId, ownerId, '2026-10-10', '2026-10-12',
    'days', 2, baseFare, damageProt, cgst, sgst, secDeposit, totalAmount,
    '100ft Road, Indiranagar, Bengaluru', 'Requesting full 100% battery charge at pickup time.', 'CONFIRMED'
  );

  db.prepare(`
    INSERT INTO payments (
      payment_code, booking_id, customer_id, amount, payment_method,
      payment_status, transaction_ref, upi_id, invoice_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    paymentCode, bookingRes.lastInsertRowid, customerId, totalAmount, 'UPI',
    'SUCCESS', 'TXN_UPI_9921448820', 'rahul@oksbi', invoiceNum
  );

  // Reviews
  db.prepare(`
    INSERT INTO reviews (vehicle_id, customer_id, rating, comment)
    VALUES (?, ?, ?, ?)
  `).run(
    vehicleIds[0], customerId, 5.0,
    'Absolutely immaculate car! Priya handed over the Nexon EV Max with 100% battery charge. AC was freezing, and the ride was whisper-quiet for our Nandi Hills day trip. Will rent again!'
  );

  console.log('✅ RideLink database seeded successfully with users, vehicles, bookings, payments, and reviews!');
}

// Initialize on require
initDatabase();

module.exports = db;
