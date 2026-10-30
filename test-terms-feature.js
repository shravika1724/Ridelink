/**
 * Test script to verify Terms & Conditions, Privacy Policy,
 * and Terms Acceptance across Registration, Booking, and Vehicle Listing.
 */
const http = require('http');

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method,
      headers
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RideLink Terms & Conditions Verification Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Static Legal Pages check (/terms, /terms.html, /privacy, /privacy.html)
  try {
    const rTerms = await apiCall('GET', '/terms');
    assert(rTerms.status === 200 && typeof rTerms.body === 'string' && rTerms.body.includes('Terms &amp; Conditions of Use'), 'GET /terms serves Terms and Conditions page');

    const rTermsHtml = await apiCall('GET', '/terms.html');
    assert(rTermsHtml.status === 200 && typeof rTermsHtml.body === 'string' && rTermsHtml.body.includes('Terms &amp; Conditions of Use'), 'GET /terms.html serves Terms and Conditions page');

    const rPrivacy = await apiCall('GET', '/privacy');
    assert(rPrivacy.status === 200 && typeof rPrivacy.body === 'string' && rPrivacy.body.includes('RideLink Privacy Policy'), 'GET /privacy serves Privacy Policy page');

    const rPrivacyHtml = await apiCall('GET', '/privacy.html');
    assert(rPrivacyHtml.status === 200 && typeof rPrivacyHtml.body === 'string' && rPrivacyHtml.body.includes('RideLink Privacy Policy'), 'GET /privacy.html serves Privacy Policy page');
  } catch (err) {
    assert(false, `Legal pages check threw error: ${err.message}`);
  }

  // 2. Registration without agree_terms (MUST FAIL with 400)
  const testEmail1 = `test_noterms_${Date.now()}@example.com`;
  try {
    const r = await apiCall('POST', '/api/auth/register', {
      name: 'No Terms User',
      email: testEmail1,
      phone: '+91 99999 11111',
      password: 'password123',
      role: 'customer',
      agree_terms: false
    });
    assert(r.status === 400 && r.body.success === false, `Registration without terms agreement rejected with 400: "${r.body.message}"`);
  } catch (err) {
    assert(false, `Registration without terms check threw error: ${err.message}`);
  }

  // 3. Registration with agree_terms: true (MUST SUCCEED with 201)
  const testEmail2 = `test_terms_${Date.now()}@example.com`;
  let customerToken = null;
  let customerUser = null;
  try {
    const r = await apiCall('POST', '/api/auth/register', {
      name: 'Compliant User',
      email: testEmail2,
      phone: '+91 99999 22222',
      password: 'password123',
      role: 'customer',
      agree_terms: true
    });
    assert(r.status === 201 && r.body.success === true, `Registration with terms agreement succeeded: "${r.body.message}"`);
    customerToken = r.body.token;
    customerUser = r.body.user;
    assert(customerUser && customerUser.terms_accepted === 1, 'Database stored terms_accepted = 1 for registered user');
  } catch (err) {
    assert(false, `Registration with terms check threw error: ${err.message}`);
  }

  // 4. Demo Login check (Verify existing functionality still works)
  let ownerToken = null;
  try {
    const rOwner = await apiCall('POST', '/api/auth/demo-login', { role: 'owner' });
    assert(rOwner.status === 200 && rOwner.body.token, `Existing Owner demo login works: ${rOwner.body.user.name}`);
    ownerToken = rOwner.body.token;
  } catch (err) {
    assert(false, `Owner demo login check threw error: ${err.message}`);
  }

  // 5. Booking creation without terms_accepted (MUST FAIL with 400)
  try {
    const r = await apiCall('POST', '/api/bookings', {
      vehicleId: 1,
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      durationType: 'days',
      durationCount: 2,
      addons: ['helmet']
    }, customerToken);
    assert(r.status === 400 && r.body.success === false, `Booking without rental terms acceptance rejected with 400: "${r.body.message}"`);
  } catch (err) {
    assert(false, `Booking without terms check threw error: ${err.message}`);
  }

  // 6. Booking creation with terms_accepted: true (MUST SUCCEED with 201)
  try {
    const r = await apiCall('POST', '/api/bookings', {
      vehicleId: 1,
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      durationType: 'days',
      durationCount: 2,
      addons: ['helmet'],
      terms_accepted: true
    }, customerToken);
    assert(r.status === 201 && r.body.success === true, `Booking with terms acceptance confirmed: Code ${r.body.booking?.booking_code}`);
    assert(r.body.booking && r.body.booking.terms_accepted === 1, 'Database stored terms_accepted = 1 for booking');
  } catch (err) {
    assert(false, `Booking with terms check threw error: ${err.message}`);
  }

  // 7. Vehicle listing without owner_declaration (MUST FAIL with 400)
  const uniqueReg1 = `KA-01-XX-${Math.floor(1000 + Math.random() * 9000)}`;
  try {
    const r = await apiCall('POST', '/api/vehicles', {
      title: 'Test Vehicle Without Declaration',
      brand: 'Hyundai',
      model: 'Creta',
      year: 2024,
      category: 'SUV',
      reg_number: uniqueReg1,
      location_city: 'Bangalore',
      price_per_day: 3200
    }, ownerToken);
    assert(r.status === 400 && r.body.success === false, `Vehicle listing without owner declaration rejected with 400: "${r.body.message}"`);
  } catch (err) {
    assert(false, `Vehicle listing without declaration check threw error: ${err.message}`);
  }

  // 8. Vehicle listing with owner_declaration: true (MUST SUCCEED with 201)
  const uniqueReg2 = `KA-01-YY-${Math.floor(1000 + Math.random() * 9000)}`;
  try {
    const r = await apiCall('POST', '/api/vehicles', {
      title: '2024 Hyundai Creta SX(O)',
      brand: 'Hyundai',
      model: 'Creta SX(O)',
      year: 2024,
      category: 'SUV',
      reg_number: uniqueReg2,
      location_city: 'Bangalore',
      location_address: 'Indiranagar 100ft Road',
      price_per_day: 3200,
      price_per_hour: 280,
      fuel_type: 'Petrol',
      transmission: 'Automatic',
      seating: 5,
      description: 'Pristine condition, panoramic sunroof, verified RC.',
      owner_declaration: true
    }, ownerToken);
    assert(r.status === 201 && r.body.success === true, `Vehicle listing with owner declaration succeeded: "${r.body.message}"`);
    assert(r.body.vehicle && r.body.vehicle.owner_declaration_accepted === 1, 'Database stored owner_declaration_accepted = 1 for vehicle');
  } catch (err) {
    assert(false, `Vehicle listing with declaration check threw error: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
