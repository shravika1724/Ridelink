/**
 * RideLink Customer Dashboard Controller
 * Profile details, KYC verification flow, trip management,
 * payment status badges, transaction history, and refund support.
 */

const CustomerDash = {
  bookings: [],
  transactions: [],
  currentTab: 'all',

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Booking Tab filter buttons
    document.querySelectorAll('.cust-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cust-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTab = btn.dataset.tab;
        this.renderBookings();
      });
    });

    // KYC Form submission
    const kycForm = document.getElementById('form-kyc-submit');
    if (kycForm) {
      kycForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dlNum = document.getElementById('kyc-dl-input').value.trim();
        const aadhaarNum = document.getElementById('kyc-aadhaar-input').value.replace(/\s/g, '');
        const dlFile = document.getElementById('kyc-dl-file').files[0];
        const aadhaarFile = document.getElementById('kyc-aadhaar-file').files[0];

        // Basic client-side validation
        const dlErr = document.getElementById('kyc-dl-error');
        const aadhaarErr = document.getElementById('kyc-aadhaar-error');
        dlErr.style.display = 'none';
        aadhaarErr.style.display = 'none';

        let valid = true;
        if (!dlNum || dlNum.length < 5) {
          dlErr.textContent = 'Please enter a valid Driving Licence number.';
          dlErr.style.display = 'block';
          valid = false;
        }
        if (!aadhaarNum || aadhaarNum.length !== 12 || !/^\d+$/.test(aadhaarNum)) {
          aadhaarErr.textContent = 'Please enter a valid 12-digit Aadhaar number.';
          aadhaarErr.style.display = 'block';
          valid = false;
        }
        if (!valid) return;

        const dlDocName = dlFile ? dlFile.name : 'dl_upload.pdf';
        const aadhaarDocName = aadhaarFile ? aadhaarFile.name : 'aadhaar_upload.pdf';

        const btn = document.getElementById('btn-kyc-submit');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...'; }

        try {
          showToast('Verifying documents via UIDAI & MoRTH sandbox API...', 'warning');
          const res = await api.post('/auth/submit-kyc', {
            dlNumber: dlNum,
            dlDocName,
            aadhaarNumber: aadhaarNum,
            aadhaarDocName
          });

          api.setSession(null, res.user);
          closeModal();
          showToast(res.message);
          this.loadData();
        } catch (err) {
          showToast(err.message || 'KYC verification failed', 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-alt"></i> Submit for Verification'; }
        }
      });
    }
  },

  async loadData() {
    const user = api.getUser();
    if (!user) {
      navigateTo('marketplace');
      return;
    }

    this.renderProfile(user);

    try {
      const [bookingsRes, txRes] = await Promise.allSettled([
        api.get('/bookings/my'),
        api.get('/payments/my-transactions')
      ]);

      if (bookingsRes.status === 'fulfilled') {
        this.bookings = bookingsRes.value.bookings || [];
        // Annotate bookings with payment info from transactions
        if (txRes.status === 'fulfilled') {
          this.transactions = txRes.value.transactions || [];
          const txByBooking = {};
          this.transactions.forEach(tx => { txByBooking[tx.booking_id] = tx; });
          this.bookings = this.bookings.map(b => ({
            ...b,
            payment: txByBooking[b.id] || null
          }));
        }
        this.renderBookings();
      }
    } catch (err) {
      console.error('Failed to load customer data:', err);
    }
  },

  renderProfile(u) {
    document.getElementById('cust-profile-name').textContent = u.name;
    document.getElementById('cust-profile-email').textContent = u.email;
    document.getElementById('cust-profile-phone').textContent = u.phone;
    document.getElementById('cust-profile-avatar').src =
      u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80';

    const kycBadge = document.getElementById('cust-kyc-badge');
    const kycBanner = document.getElementById('cust-kyc-action-banner');

    if (u.kyc_status === 'VERIFIED') {
      kycBadge.className = 'badge badge-verified';
      kycBadge.innerHTML = `<i class="fas fa-shield-alt"></i> ID Verified`;
      if (kycBanner) kycBanner.style.display = 'none';
      document.getElementById('cust-masked-dl').textContent = u.dl_number_masked || 'DL-04-XXXX-4819';
      document.getElementById('cust-masked-aadhaar').textContent = u.aadhaar_number_masked || 'XXXX-XXXX-7842';
    } else {
      kycBadge.className = 'badge badge-pending';
      kycBadge.innerHTML = `<i class="fas fa-clock"></i> Verification ${u.kyc_status}`;
      if (kycBanner) kycBanner.style.display = 'flex';
      document.getElementById('cust-masked-dl').textContent = u.dl_number_masked || 'Not Submitted';
      document.getElementById('cust-masked-aadhaar').textContent = u.aadhaar_number_masked || 'Not Submitted';
    }
  },

  renderBookings() {
    const container = document.getElementById('cust-bookings-list');
    if (!container) return;

    let filtered = this.bookings;
    if (this.currentTab !== 'all') {
      filtered = this.bookings.filter(b => b.status.toLowerCase() === this.currentTab.toLowerCase());
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-calendar-times"></i>
          <h3>No ${this.currentTab} trips found</h3>
          <p>Ready for your next journey? Browse thousands of shared vehicles on RideLink.</p>
          <button class="btn btn-primary" onclick="navigateTo('marketplace')">
            <i class="fas fa-search"></i> Explore Vehicles
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(b => {
      const photo = (b.photos && b.photos.length > 0) ? b.photos[0] : '/assets/vehicle-ev-suv.jpg';
      const payment = b.payment;
      const isRefunded = b.status === 'CANCELLED' || payment?.transaction_ref?.startsWith('REFUNDED_');
      const payStatus = isRefunded ? 'REFUNDED' : (payment ? payment.payment_status : (b.status === 'PENDING' ? 'NOT_INITIATED' : null));

      // Booking status badge
      let statusBadge = `<span class="badge badge-confirmed"><i class="fas fa-check"></i> Confirmed</span>`;
      if (b.status === 'PENDING')    statusBadge = `<span class="badge badge-pending"><i class="fas fa-hourglass-half"></i> Awaiting Payment</span>`;
      if (b.status === 'ACTIVE')     statusBadge = `<span class="badge badge-electric"><i class="fas fa-road"></i> Trip In Progress</span>`;
      if (b.status === 'COMPLETED')  statusBadge = `<span class="badge badge-completed"><i class="fas fa-flag-checkered"></i> Completed</span>`;
      if (b.status === 'CANCELLED')  statusBadge = `<span class="badge badge-cancelled"><i class="fas fa-times"></i> Cancelled</span>`;

      // Payment status badge
      let payBadge = '';
      if (payStatus === 'SUCCESS')   payBadge = `<span class="badge badge-payment-success" style="font-size:0.7rem;"><i class="fas fa-check-circle"></i> Paid</span>`;
      if (payStatus === 'FAILED')    payBadge = `<span class="badge badge-payment-failed" style="font-size:0.7rem;"><i class="fas fa-exclamation-circle"></i> Payment Failed</span>`;
      if (payStatus === 'REFUNDED')  payBadge = `<span class="badge badge-payment-refunded" style="font-size:0.7rem;"><i class="fas fa-undo"></i> Refunded</span>`;
      if (payStatus === 'NOT_INITIATED') payBadge = `<span class="badge badge-payment-pending" style="font-size:0.7rem;"><i class="fas fa-clock"></i> Pay Now</span>`;

      // Payment method display
      const methodLabel = payment
        ? (payment.payment_method === 'RAZORPAY' ? '💳 Razorpay'
         : payment.payment_method === 'DEMO' ? '🧪 Demo'
         : payment.payment_method)
        : '';

      return `
        <div class="booking-card">
          <img src="${photo}" alt="${b.vehicle_title}" class="booking-thumb">

          <div class="booking-info">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap:wrap; margin-bottom: 0.35rem;">
              <h4>${b.vehicle_title}</h4>
              ${statusBadge}
              ${payBadge}
            </div>
            <div class="booking-dates">
              <i class="fas fa-calendar-alt"></i>
              <span>${b.start_date} to ${b.end_date} (${b.duration_count} ${b.duration_type})</span>
            </div>
            <div class="booking-meta-row">
              <span><i class="fas fa-id-badge"></i> ${b.booking_code}</span>
              <span><i class="fas fa-user"></i> Host: ${b.owner_name}</span>
              <span><i class="fas fa-rupee-sign"></i> <strong>₹${b.total_amount.toLocaleString('en-IN')}</strong></span>
              ${methodLabel ? `<span style="font-size:0.78rem;color:var(--text-dim);">${methodLabel}</span>` : ''}
            </div>
            ${payment && payment.transaction_ref ? `
              <div style="font-size:0.76rem;color:var(--text-dim);margin-top:0.25rem;font-family:monospace;">
                Txn: ${payment.transaction_ref}
              </div>
            ` : ''}
          </div>

          <div class="booking-card-actions">
            ${/* Chat button */''}
            ${['CONFIRMED', 'ACTIVE'].includes(b.status) ? `
              <button class="btn btn-emerald btn-sm" onclick="ChatReview.openChat(${b.id}, '${b.owner_name}')">
                <i class="fas fa-comments"></i> Chat Host
              </button>
            ` : ''}

            ${/* Rate trip */''}
            ${b.status === 'COMPLETED' ? `
              <button class="btn btn-primary btn-sm" onclick="ChatReview.openReviewModal(${b.id}, '${b.vehicle_title}')">
                <i class="fas fa-star"></i> Rate Trip
              </button>
            ` : ''}

            ${/* Tax invoice */''}
            ${payStatus === 'SUCCESS' && payment?.invoice_number ? `
              <button class="btn btn-outline btn-sm" onclick="PaymentFlow.showTaxInvoice('${payment.invoice_number}')">
                <i class="fas fa-file-invoice"></i> Tax Invoice
              </button>
            ` : ''}

            ${/* PAY NOW or RETRY */''}
            ${b.status === 'PENDING' ? `
              <button class="btn btn-primary btn-sm" onclick="CustomerDash.payNow(${b.id})">
                <i class="fas fa-credit-card"></i> ${payStatus === 'FAILED' ? 'Retry Payment' : 'Pay Now'}
              </button>
            ` : ''}

            ${/* Refund button for confirmed bookings that have been paid */''}
            ${b.status === 'CONFIRMED' && payStatus === 'SUCCESS' ? `
              <button class="btn btn-danger btn-sm" onclick="CustomerDash.cancelWithRefund(${b.id})">
                <i class="fas fa-undo"></i> Cancel & Refund
              </button>
            ` : ''}

            ${/* Cancel without payment (pending bookings) */''}
            ${b.status === 'PENDING' ? `
              <button class="btn btn-danger btn-sm" onclick="CustomerDash.cancelBooking(${b.id})">
                <i class="fas fa-ban"></i> Cancel
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  // ── Pay Now / Retry ───────────────────────────────────────
  async payNow(bookingId) {
    if (window.RazorpayFlow) {
      await RazorpayFlow.initiate(bookingId);
    } else if (window.PaymentFlow) {
      PaymentFlow.open(bookingId);
    }
  },

  // ── Cancel with Refund ────────────────────────────────────
  async cancelWithRefund(bookingId) {
    if (!confirm('Cancel this booking and request a refund? The amount (minus security deposit) will be credited in 5-7 business days.')) {
      return;
    }

    try {
      showToast('Processing refund request...', 'warning');
      const res = await api.post(`/payments/refund/${bookingId}`);
      showToast(res.message || 'Refund initiated!');
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Refund failed. Please contact support.', 'error');
    }
  },

  // ── Cancel without payment ────────────────────────────────
  async cancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;

    try {
      const res = await api.post(`/bookings/${bookingId}/cancel`);
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to cancel booking', 'error');
    }
  }
};

window.CustomerDash = CustomerDash;
document.addEventListener('DOMContentLoaded', () => CustomerDash.init());

// ── KYC Modal Helpers ─────────────────────────────────────────────────────────
const KycModal = {
  /** Called when a file is picked via the file input */
  onFileChange(type, input) {
    if (input.files && input.files[0]) {
      this._setFileLabel(type, input.files[0].name);
    }
  },

  /** Called when a file is dropped onto the dropzone */
  onFileDrop(type, event) {
    event.preventDefault();
    const dropzone = document.getElementById(`kyc-${type}-dropzone`);
    if (dropzone) dropzone.classList.remove('drag-over');

    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (!file) return;

    // Transfer the dropped file to the hidden input so it can be read on submit
    const input = document.getElementById(`kyc-${type}-file`);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    this._setFileLabel(type, file.name);
  },

  /** Updates the dropzone label & styling after a file is selected */
  _setFileLabel(type, name) {
    const label = document.getElementById(`kyc-${type}-file-label`);
    const dropzone = document.getElementById(`kyc-${type}-dropzone`);
    if (label) {
      label.innerHTML = `<i class="fas fa-check-circle" style="color: var(--accent-emerald); margin-right: 0.4rem;"></i>${name}`;
    }
    if (dropzone) {
      dropzone.style.borderColor = 'var(--accent-emerald)';
      dropzone.style.background = 'rgba(16,185,129,0.06)';
    }
  },

  /** Auto-formats Aadhaar input as XXXX XXXX XXXX */
  formatAadhaar(input) {
    let val = input.value.replace(/\D/g, '').substring(0, 12);
    const parts = [];
    for (let i = 0; i < val.length; i += 4) parts.push(val.slice(i, i + 4));
    input.value = parts.join(' ');
  },

  /** Reset dropzones when the KYC modal opens */
  reset() {
    ['dl', 'aadhaar'].forEach(type => {
      const input = document.getElementById(`kyc-${type}-file`);
      const label = document.getElementById(`kyc-${type}-file-label`);
      const dropzone = document.getElementById(`kyc-${type}-dropzone`);
      const errEl = document.getElementById(`kyc-${type}-error`);
      if (input) input.value = '';
      if (label) {
        label.innerHTML = `Click or drag &amp; drop your ${type === 'dl' ? 'DL' : 'Aadhaar'} document here`;
      }
      if (dropzone) {
        dropzone.style.borderColor = '';
        dropzone.style.background = 'rgba(255,255,255,0.02)';
      }
      if (errEl) errEl.style.display = 'none';
    });
    const dlInput = document.getElementById('kyc-dl-input');
    const aadhaarInput = document.getElementById('kyc-aadhaar-input');
    // Don't clear if user is re-submitting (keep existing values)
  }
};

window.KycModal = KycModal;

// Reset the KYC form whenever the modal overlay is opened
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('modal-kyc-verify');
  if (overlay) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        if (m.attributeName === 'class' && overlay.classList.contains('active')) {
          KycModal.reset();
        }
      });
    });
    observer.observe(overlay, { attributes: true });
  }
});
