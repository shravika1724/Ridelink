/**
 * RideLink Razorpay Payment Flow
 * Integrates Razorpay Standard Checkout (TEST MODE)
 * - Backend creates order → Frontend opens Razorpay checkout
 * - Backend verifies HMAC-SHA256 signature BEFORE confirming booking
 * - Never confirms booking based on frontend-reported success alone
 * - Handles success, failure, cancellation, and retry flows
 */

const RazorpayFlow = {
  activeBookingId: null,
  activeBookingData: null,
  currentOrderId: null,

  // ── Entry point: open Razorpay checkout ─────────────────
  async initiate(bookingId) {
    this.activeBookingId = bookingId;

    try {
      // 1. Fetch checkout summary
      const summaryRes = await api.get(`/payments/checkout-summary/${bookingId}`);
      this.activeBookingData = summaryRes.booking;

      // If already paid, skip to success
      if (summaryRes.existingPayment) {
        showToast('This booking is already paid!');
        this.showSuccessScreen({
          success: true,
          bookingCode: summaryRes.booking.booking_code,
          payment: summaryRes.existingPayment,
          invoiceNumber: summaryRes.existingPayment.invoice_number
        });
        return;
      }

      // 2. Create order on backend
      showToast('Preparing secure payment...', 'warning');
      const orderRes = await api.post('/payments/create-order', { bookingId });

      // 3a. Demo mode (Razorpay not configured)
      if (orderRes.demoMode || !orderRes.keyId) {
        this.openDemoCheckout(orderRes);
        return;
      }

      // 3b. Real Razorpay checkout
      this.currentOrderId = orderRes.orderId;
      this.openRazorpayCheckout(orderRes);

    } catch (err) {
      showToast(err.message || 'Failed to initiate payment', 'error');
    }
  },

  // ── Real Razorpay Standard Checkout ─────────────────────
  openRazorpayCheckout(orderData) {
    if (typeof Razorpay === 'undefined') {
      showToast('Razorpay SDK not loaded. Check your internet connection.', 'error');
      return;
    }

    const b = this.activeBookingData;
    const user = api.getUser();

    const options = {
      key: orderData.keyId,
      amount: orderData.amount,      // in paise
      currency: 'INR',
      name: 'RideLink Mobility',
      description: `Booking: ${b.booking_code} — ${b.vehicle_title}`,
      order_id: orderData.orderId,
      prefill: {
        name: orderData.customerName || user?.name || '',
        email: orderData.customerEmail || user?.email || '',
        contact: orderData.customerPhone || user?.phone || ''
      },
      notes: {
        booking_id: String(this.activeBookingId),
        booking_code: b.booking_code
      },
      theme: {
        color: '#06B6D4'
      },
      modal: {
        ondismiss: () => {
          showToast('Payment window closed. You can retry from My Bookings.', 'warning');
        }
      },
      // ── Payment Success Handler ────────────────────────
      handler: async (response) => {
        showToast('Verifying payment on server...', 'warning');
        try {
          const verifyRes = await api.post('/payments/verify', {
            bookingId: this.activeBookingId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          });

          if (verifyRes.success) {
            this.showSuccessScreen(verifyRes);
          } else {
            showToast('Server verification failed. Contact support.', 'error');
          }
        } catch (err) {
          showToast(err.message || 'Server verification failed', 'error');
        }
      }
    };

    const rzp = new Razorpay(options);

    // ── Payment Failure Handler ────────────────────────────
    rzp.on('payment.failed', async (response) => {
      showToast(`Payment failed: ${response.error.description}`, 'error');
      try {
        await api.post('/payments/failure', {
          bookingId: this.activeBookingId,
          reason: response.error.description
        });
      } catch (e) { /* log silently */ }
      this.showFailureScreen(response.error);
    });

    rzp.open();
  },

  // ── Demo Checkout (when Razorpay not configured) ─────────
  openDemoCheckout(orderData) {
    const b = this.activeBookingData;

    // Update demo modal fields
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('pay-booking-code', b.booking_code);
    setEl('pay-vehicle-title', b.vehicle_title);
    setEl('pay-total-amount', `₹${b.total_amount.toLocaleString('en-IN')}`);
    setEl('pay-base-amt', `₹${b.base_amount.toLocaleString('en-IN')}`);
    setEl('pay-shield-amt', `₹${b.damage_protection_fee.toLocaleString('en-IN')}`);
    setEl('pay-cgst-amt', `₹${b.gst_cgst.toFixed(2)}`);
    setEl('pay-sgst-amt', `₹${b.gst_sgst.toFixed(2)}`);
    setEl('pay-deposit-amt', `₹${b.security_deposit.toLocaleString('en-IN')}`);

    // Show Razorpay notice
    const notice = document.getElementById('razorpay-demo-notice');
    if (notice) notice.style.display = 'block';

    if (window.PaymentFlow) {
      window.PaymentFlow.activeBookingId = this.activeBookingId;
      window.PaymentFlow.activeBookingData = b;
      if (orderData) {
        window.PaymentFlow.activeBookingData.upiPayload = orderData.upiPayload;
        window.PaymentFlow.activeBookingData.qrCodeDataUrl = orderData.qrCodeDataUrl;
      }
      window.PaymentFlow.renderQrCode(orderData?.upiPayload, orderData?.qrCodeDataUrl);
      window.PaymentFlow.switchPaymentTab('UPI');
      openModal('modal-payment-gateway');
    }
  },

  // ── Show Success Screen ───────────────────────────────────
  showSuccessScreen(res) {
    closeModal();

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('success-booking-code', res.bookingCode || res.payment?.booking_id);
    setEl('success-txn-ref', res.payment?.transaction_ref || res.payment?.razorpay_payment_id || '—');
    setEl('success-amount', `₹${(res.payment?.amount || 0).toLocaleString('en-IN')}`);
    setEl('success-method', res.payment?.payment_method || 'RAZORPAY');
    setEl('success-invoice-num', res.invoiceNumber || res.payment?.invoice_number);

    const btnInvoice = document.getElementById('btn-success-view-invoice');
    if (btnInvoice && res.invoiceNumber) {
      btnInvoice.onclick = () => {
        if (window.PaymentFlow) window.PaymentFlow.showTaxInvoice(res.invoiceNumber);
      };
    }

    openModal('modal-payment-success');
    showToast('🎉 Booking confirmed! Payment verified by server.');

    // Refresh My Bookings if visible
    if (window.CustomerDash) window.CustomerDash.loadData();
  },

  // ── Show Failure Screen ───────────────────────────────────
  showFailureScreen(error) {
    const failureModal = document.getElementById('modal-payment-failure');
    if (failureModal) {
      const reasonEl = document.getElementById('failure-reason');
      if (reasonEl) reasonEl.textContent = error?.description || 'Payment could not be processed';

      const retryBtn = document.getElementById('btn-retry-payment');
      if (retryBtn) {
        retryBtn.onclick = () => {
          closeModal();
          this.initiate(this.activeBookingId);
        };
      }

      openModal('modal-payment-failure');
    } else {
      showToast('Payment failed. Retry from My Bookings.', 'error');
    }
  },

  // ── Load Razorpay SDK dynamically ─────────────────────────
  loadRazorpaySDK() {
    return new Promise((resolve, reject) => {
      if (typeof Razorpay !== 'undefined') { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
      document.head.appendChild(script);
    });
  }
};

// Load Razorpay SDK on page load
document.addEventListener('DOMContentLoaded', () => {
  RazorpayFlow.loadRazorpaySDK().catch(err => {
    console.warn('Razorpay SDK not loaded:', err.message);
  });
});

window.RazorpayFlow = RazorpayFlow;
