/**
 * RideLink Sandbox Payment Gateway & Tax Invoice Controller
 * UPI, Dynamic QR Code with timer, Credit/Debit Card with 3D Secure OTP, NetBanking, and GST Invoice
 */

const PaymentFlow = {
  activeBookingId: null,
  activeBookingData: null,
  selectedMethod: 'UPI',
  qrTimerInterval: null,
  qrSecondsLeft: 300,

  async open(bookingId) {
    this.activeBookingId = bookingId;
    this.selectedMethod = 'UPI';

    try {
      const res = await api.get(`/payments/checkout-summary/${bookingId}`);
      this.activeBookingData = res.booking;
      if (this.activeBookingData) {
        this.activeBookingData.upiPayload = res.upiPayload;
        this.activeBookingData.qrCodeDataUrl = res.qrCodeDataUrl;
      }

      this.renderCheckoutSummary(res.booking, res.upiPayload, res.qrCodeDataUrl);
      this.switchPaymentTab('UPI');
      openModal('modal-payment-gateway');
    } catch (err) {
      showToast(err.message || 'Failed to load checkout details', 'error');
    }
  },

  renderCheckoutSummary(b, upiPayload, qrCodeDataUrl) {
    // Header summary
    document.getElementById('pay-booking-code').textContent = b.booking_code;
    document.getElementById('pay-vehicle-title').textContent = b.vehicle_title;
    document.getElementById('pay-total-amount').textContent = `₹${b.total_amount.toLocaleString('en-IN')}`;

    // Itemized review
    document.getElementById('pay-base-amt').textContent = `₹${b.base_amount.toLocaleString('en-IN')}`;
    document.getElementById('pay-shield-amt').textContent = `₹${b.damage_protection_fee.toLocaleString('en-IN')}`;
    document.getElementById('pay-cgst-amt').textContent = `₹${b.gst_cgst.toFixed(2)}`;
    document.getElementById('pay-sgst-amt').textContent = `₹${b.gst_sgst.toFixed(2)}`;
    document.getElementById('pay-deposit-amt').textContent = `₹${b.security_deposit.toLocaleString('en-IN')}`;

    // Generate dynamic QR Code for UPI
    const upi = upiPayload || `upi://pay?pa=ridelink.payments@icici&pn=RideLink&am=${b.total_amount}&cu=INR&tn=${encodeURIComponent(b.booking_code)}`;
    this.renderQrCode(upi, qrCodeDataUrl);
  },

  switchPaymentTab(method) {
    this.selectedMethod = method;

    // Tab buttons
    document.querySelectorAll('.pay-tab-btn').forEach(btn => {
      if (btn.dataset.method === method) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Tab panels
    document.querySelectorAll('.payment-tab-content').forEach(panel => {
      if (panel.id === `tab-pay-${method.toLowerCase()}`) {
        panel.style.display = 'block';
      } else {
        panel.style.display = 'none';
      }
    });

    // Start timer and generate QR if QR code selected
    if (method === 'QR') {
      this.startQrTimer();
      const b = this.activeBookingData;
      const upi = b ? (b.upiPayload || `upi://pay?pa=ridelink.payments@icici&pn=RideLink&am=${b.total_amount}&cu=INR&tn=${encodeURIComponent(b.booking_code)}`) : '';
      const qrUrl = b ? b.qrCodeDataUrl : null;
      this.renderQrCode(upi, qrUrl);
    } else {
      this.stopQrTimer();
    }
  },

  async renderQrCode(text, dataUrl) {
    const qrContainer = document.getElementById('qr-code-display');
    if (!qrContainer) return;

    // 1. If pre-rendered data URL exists, show it directly
    if (dataUrl) {
      qrContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
          <img src="${dataUrl}" alt="Scan to Pay via UPI" style="width: 200px; height: 200px; border-radius: 8px; display: block; object-fit: contain;" />
          <span style="font-size: 0.72rem; color: #0f172a; font-weight: 700; letter-spacing: 0.4px;">SCAN VIA GPAY / PHONEPE / PAYTM</span>
        </div>
      `;
      return;
    }

    // 2. If active booking exists, fetch QR data URL from backend
    if (this.activeBookingId && !this._fetchingQr) {
      this._fetchingQr = true;
      try {
        const qrRes = await api.get(`/payments/qr/${this.activeBookingId}`);
        this._fetchingQr = false;
        if (qrRes && qrRes.qrCodeDataUrl) {
          if (this.activeBookingData) {
            this.activeBookingData.qrCodeDataUrl = qrRes.qrCodeDataUrl;
            this.activeBookingData.upiPayload = qrRes.upiPayload;
          }
          this.renderQrCode(qrRes.upiPayload, qrRes.qrCodeDataUrl);
          return;
        }
      } catch (e) {
        this._fetchingQr = false;
      }
    }

    // 3. High quality SVG fallback pattern
    const amt = this.activeBookingData ? `₹${this.activeBookingData.total_amount}` : '';
    qrContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
        <svg class="qr-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" fill="#ffffff" rx="10"/>
          <!-- Corner Markers -->
          <rect x="15" y="15" width="45" height="45" fill="#0f172a" rx="4"/>
          <rect x="23" y="23" width="29" height="29" fill="#ffffff" rx="2"/>
          <rect x="29" y="29" width="17" height="17" fill="#06B6D4" rx="2"/>

          <rect x="140" y="15" width="45" height="45" fill="#0f172a" rx="4"/>
          <rect x="148" y="23" width="29" height="29" fill="#ffffff" rx="2"/>
          <rect x="154" y="29" width="17" height="17" fill="#06B6D4" rx="2"/>

          <rect x="15" y="140" width="45" height="45" fill="#0f172a" rx="4"/>
          <rect x="23" y="148" width="29" height="29" fill="#ffffff" rx="2"/>
          <rect x="29" y="154" width="17" height="17" fill="#06B6D4" rx="2"/>

          <!-- Data Matrix Dots Pattern -->
          <g fill="#0f172a">
            <rect x="70" y="20" width="8" height="8"/>
            <rect x="85" y="20" width="8" height="8"/>
            <rect x="100" y="20" width="8" height="8"/>
            <rect x="115" y="20" width="8" height="8"/>
            <rect x="70" y="35" width="15" height="8"/>
            <rect x="95" y="35" width="8" height="15"/>
            <rect x="115" y="35" width="8" height="8"/>

            <rect x="20" y="70" width="8" height="8"/>
            <rect x="35" y="70" width="15" height="8"/>
            <rect x="70" y="60" width="8" height="8"/>
            <rect x="85" y="60" width="15" height="8"/>
            <rect x="110" y="60" width="8" height="8"/>
            <rect x="130" y="60" width="15" height="8"/>
            <rect x="155" y="70" width="15" height="8"/>
            <rect x="175" y="70" width="8" height="8"/>

            <!-- Center RideLink Crest -->
            <circle cx="100" cy="100" r="18" fill="#10B981"/>
            <path d="M93 100 L98 105 L108 94" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round"/>

            <rect x="20" y="90" width="15" height="8"/>
            <rect x="45" y="90" width="8" height="15"/>
            <rect x="65" y="90" width="15" height="8"/>
            <rect x="130" y="90" width="15" height="8"/>
            <rect x="155" y="90" width="8" height="15"/>
            <rect x="170" y="90" width="15" height="8"/>

            <rect x="20" y="115" width="8" height="15"/>
            <rect x="35" y="120" width="15" height="8"/>
            <rect x="70" y="115" width="8" height="8"/>
            <rect x="90" y="125" width="20" height="8"/>
            <rect x="120" y="115" width="15" height="8"/>
            <rect x="150" y="120" width="8" height="8"/>
            <rect x="170" y="115" width="15" height="8"/>

            <rect x="70" y="145" width="8" height="8"/>
            <rect x="90" y="145" width="15" height="8"/>
            <rect x="115" y="145" width="8" height="8"/>
            <rect x="140" y="145" width="15" height="8"/>
            <rect x="165" y="145" width="8" height="8"/>

            <rect x="70" y="165" width="15" height="8"/>
            <rect x="95" y="160" width="8" height="15"/>
            <rect x="115" y="165" width="15" height="8"/>
            <rect x="140" y="165" width="8" height="8"/>
            <rect x="160" y="160" width="15" height="15"/>
          </g>
        </svg>
        <span style="font-size: 0.72rem; color: #0f172a; font-weight: 700; letter-spacing: 0.4px;">SCAN VIA GPAY / PHONEPE / PAYTM ${amt}</span>
      </div>
    `;
  },

  startQrTimer() {
    this.stopQrTimer();
    this.qrSecondsLeft = 300;
    const timerEl = document.getElementById('qr-countdown-text');

    const updateDisplay = () => {
      const mins = Math.floor(this.qrSecondsLeft / 60);
      const secs = this.qrSecondsLeft % 60;
      if (timerEl) {
        timerEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }
    };

    updateDisplay();
    this.qrTimerInterval = setInterval(() => {
      this.qrSecondsLeft--;
      if (this.qrSecondsLeft <= 0) {
        this.stopQrTimer();
        if (timerEl) timerEl.textContent = 'Expired. Tap to refresh.';
      } else {
        updateDisplay();
      }
    }, 1000);
  },

  stopQrTimer() {
    if (this.qrTimerInterval) {
      clearInterval(this.qrTimerInterval);
      this.qrTimerInterval = null;
    }
  },

  // Process Demo Payment
  async processPayment(methodOverride, extraData = {}) {
    const method = methodOverride || this.selectedMethod;

    const payload = {
      bookingId: this.activeBookingId,
      paymentMethod: method,
      ...extraData
    };

    if (method === 'UPI') {
      const upiInput = document.getElementById('input-custom-upi')?.value;
      payload.upiId = extraData.upiId || upiInput || 'customer@okaxis';
    } else if (method === 'CARD') {
      payload.cardNumber = extraData.cardNumber || document.getElementById('card-input-number')?.value || '4532889211244242';
      payload.cardHolder = extraData.cardHolder || document.getElementById('card-input-name')?.value || 'RAHUL SHARMA';
      payload.cardExpiry = extraData.cardExpiry || document.getElementById('card-input-expiry')?.value || '08/28';
      payload.cardCvv = '•••';
    } else if (method === 'NETBANKING') {
      payload.bankName = extraData.bankName || document.getElementById('netbanking-selected-bank')?.value || 'HDFC Bank';
    }

    try {
      showToast('Processing secure payment transaction...', 'warning');

      const res = await api.post('/payments/process-demo', payload);

      this.stopQrTimer();
      closeModal(); // Close checkout modal

      // Show Payment Success Modal
      this.showSuccessModal(res);
    } catch (err) {
      showToast(err.message || 'Payment failed', 'error');
    }
  },

  showSuccessModal(res) {
    document.getElementById('success-booking-code').textContent = res.bookingCode;
    document.getElementById('success-txn-ref').textContent = res.payment.transaction_ref;
    document.getElementById('success-amount').textContent = `₹${res.payment.amount.toLocaleString('en-IN')}`;
    document.getElementById('success-method').textContent = res.payment.payment_method;
    document.getElementById('success-invoice-num').textContent = res.invoiceNumber;

    const btnInvoice = document.getElementById('btn-success-view-invoice');
    if (btnInvoice) {
      btnInvoice.onclick = () => this.showTaxInvoice(res.invoiceNumber);
    }

    openModal('modal-payment-success');
    showToast('Payment confirmed! Your ride is booked.');

    // Refresh customer dashboard bookings & transaction history if active
    if (window.CustomerDash) window.CustomerDash.loadData();
  },

  async showTaxInvoice(invoiceNumber) {
    try {
      const res = await api.get(`/payments/invoice/${invoiceNumber}`);
      const inv = res.invoice;

      // Populate Tax Invoice Fields
      document.getElementById('inv-num-display').textContent = inv.invoice_number;
      document.getElementById('inv-date-display').textContent = new Date(inv.paid_at).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      document.getElementById('inv-booking-ref').textContent = inv.booking_code;
      document.getElementById('inv-txn-ref').textContent = inv.transaction_ref;

      // Customer
      document.getElementById('inv-cust-name').textContent = inv.customer_name;
      document.getElementById('inv-cust-email').textContent = inv.customer_email;
      document.getElementById('inv-cust-phone').textContent = inv.customer_phone;

      // Host & Vehicle
      document.getElementById('inv-host-name').textContent = inv.owner_name;
      document.getElementById('inv-vehicle-title').textContent = `${inv.vehicle_brand} ${inv.vehicle_model} (${inv.reg_number})`;
      document.getElementById('inv-rental-period').textContent = `${inv.start_date} to ${inv.end_date} (${inv.duration_count} ${inv.duration_type})`;
      document.getElementById('inv-pickup-spot').textContent = inv.pickup_location;

      // Itemized calculations
      document.getElementById('inv-base-fare').textContent = `₹${inv.base_amount.toLocaleString('en-IN')}`;
      document.getElementById('inv-shield-fee').textContent = `₹${inv.damage_protection_fee.toLocaleString('en-IN')}`;
      document.getElementById('inv-cgst').textContent = `₹${inv.gst_cgst.toFixed(2)}`;
      document.getElementById('inv-sgst').textContent = `₹${inv.gst_sgst.toFixed(2)}`;
      document.getElementById('inv-sec-deposit').textContent = `₹${inv.security_deposit.toLocaleString('en-IN')}`;
      document.getElementById('inv-grand-total').textContent = `₹${inv.total_amount.toLocaleString('en-IN')}`;
      document.getElementById('inv-pay-method').textContent = inv.payment_method;

      // Invoice Verification QR Code
      const qrEl = document.getElementById('inv-qr-display');
      if (qrEl) {
        if (res.qrCodeDataUrl) {
          qrEl.innerHTML = `<img src="${res.qrCodeDataUrl}" alt="GST QR" style="width: 80px; height: 80px; display: block;" />`;
        }
      }

      closeModal();
      openModal('modal-tax-invoice');
    } catch (err) {
      showToast(err.message || 'Failed to retrieve invoice', 'error');
    }
  }
};

window.PaymentFlow = PaymentFlow;
