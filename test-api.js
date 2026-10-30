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
      path: '/api' + path,
      method,
      headers
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runTests() {
  console.log('\n🧪 RideLink API Test Suite\n' + '='.repeat(50));

  // 1. Check server health
  try {
    const r = await apiCall('GET', '/vehicles', null);
    const vehicles = r.body.vehicles || [];
    console.log(`\n✅ [1] GET /vehicles — ${vehicles.length} vehicles loaded`);
    vehicles.slice(0, 3).forEach(v => console.log(`   • ${v.title} (₹${v.price_per_day}/day)`));
  } catch (e) {
    console.log('❌ [1] GET /vehicles failed:', e.message);
  }

  // 2. Demo login
  let token = null;
  try {
    const r = await apiCall('POST', '/auth/demo-login', { role: 'customer' });
    token = r.body.token;
    const u = r.body.user;
    console.log(`\n✅ [2] Demo login — ${u.name} (${u.role}) | KYC: ${u.kyc_status}`);
    console.log(`   Token: ${token.slice(0, 30)}...`);
  } catch (e) {
    console.log('❌ [2] Demo login failed:', e.message);
  }

  // 3. Forgot password (demo OTP)
  try {
    const r = await apiCall('POST', '/auth/forgot-password', { email: 'rahul@customer.com' });
    console.log(`\n✅ [3] Forgot password OTP — ${r.body.message}`);
    if (r.body.demoOtp) console.log(`   Demo OTP: ${r.body.demoOtp}`);
  } catch (e) {
    console.log('❌ [3] Forgot password failed:', e.message);
  }

  // 4. Create booking + payment order (authenticated)
  if (token) {
    // Get a vehicle ID first
    const vRes = await apiCall('GET', '/vehicles', null);
    const vehicleId = vRes.body.vehicles[0]?.id;

    // Create a booking
    try {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 3);
      const fmt = d => d.toISOString().slice(0, 10);

      const bRes = await apiCall('POST', '/bookings', {
        vehicleId,
        startDate: fmt(tomorrow),
        endDate: fmt(dayAfter),
        durationType: 'day',
        durationCount: 2,
        pickupLocation: 'Test Pickup',
        terms_accepted: true
      }, token);

      if (bRes.body.success) {
        const booking = bRes.body.booking;
        console.log(`\n✅ [4] Booking created — ${booking.booking_code} | ₹${booking.total_amount}`);

        // 5. Create Razorpay order (or demo order)
        try {
          const oRes = await apiCall('POST', '/payments/create-order', { bookingId: booking.id }, token);
          if (oRes.body.success) {
            const od = oRes.body;
            if (od.demoMode) {
              console.log(`\n✅ [5] Demo payment order — ID: ${od.orderId} | ₹${od.amount / 100}`);
            } else {
              console.log(`\n✅ [5] Razorpay TEST order — ${od.orderId} | ₹${od.amount / 100} | Key: ${od.keyId}`);
            }

            // 6. Simulate payment verification (demo mode)
            const vfRes = await apiCall('POST', '/payments/verify', { bookingId: booking.id }, token);
            if (vfRes.body.success) {
              const p = vfRes.body.payment;
              console.log(`\n✅ [6] Payment verified — ${p.payment_status} | Invoice: ${vfRes.body.invoiceNumber}`);
            } else {
              console.log(`❌ [6] Payment verify failed: ${vfRes.body.message}`);
            }
          } else {
            console.log(`❌ [5] Create order failed: ${oRes.body.message}`);
          }
        } catch (e) {
          console.log('❌ [5] Create order error:', e.message);
        }
      } else {
        console.log(`❌ [4] Booking failed: ${bRes.body.message}`);
      }
    } catch (e) {
      console.log('❌ [4] Booking error:', e.message);
    }

    // 7. Transaction history
    try {
      const tRes = await apiCall('GET', '/payments/my-transactions', null, token);
      console.log(`\n✅ [7] Transaction history — ${tRes.body.transactions?.length || 0} records`);
    } catch (e) {
      console.log('❌ [7] Transactions failed:', e.message);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('🏁 Test complete. Open http://localhost:5000 in your browser to see the app.\n');
}

runTests().catch(console.error);
