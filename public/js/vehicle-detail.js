/**
 * RideLink Vehicle Detail & Live Calculator Controller
 * Multi-photo switcher, itemized GST breakdown, and booking initiation
 */

const VehicleDetail = {
  currentVehicle: null,
  calcState: {
    durationType: 'days',
    durationCount: 2,
    startDate: '',
    endDate: ''
  },

  async open(vehicleId, directBookFocus = false) {
    try {
      const res = await api.get(`/vehicles/${vehicleId}`);
      this.currentVehicle = res.vehicle;
      window.RideLink.selectedVehicle = res.vehicle;

      this.render();
      openModal('modal-vehicle-detail');

      // Initialize default dates (today to +2 days)
      this.initDates();
      this.recalculate();

      // Reset terms agreement checkbox to unchecked
      const termsBox = document.getElementById('calc-terms-agree');
      if (termsBox) termsBox.checked = false;
      const termsErr = document.getElementById('calc-terms-error');
      if (termsErr) termsErr.style.display = 'none';

      if (directBookFocus) {
        document.getElementById('calc-booking-box')?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      showToast(err.message || 'Failed to open vehicle details', 'error');
    }
  },

  initDates() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 2);

    const formatDate = (d) => d.toISOString().split('T')[0];

    this.calcState.startDate = formatDate(tomorrow);
    this.calcState.endDate = formatDate(dayAfter);
    this.calcState.durationCount = 2;
    this.calcState.durationType = 'days';

    const startInput = document.getElementById('calc-start-date');
    const endInput = document.getElementById('calc-end-date');

    if (startInput) {
      startInput.value = this.calcState.startDate;
      startInput.min = formatDate(today);
    }
    if (endInput) {
      endInput.value = this.calcState.endDate;
      endInput.min = formatDate(tomorrow);
    }
  },

  render() {
    const v = this.currentVehicle;
    if (!v) return;

    // Photos
    const photos = v.photos && v.photos.length > 0 ? v.photos : ['/assets/vehicle-ev-suv.jpg'];
    const mainImgEl = document.getElementById('detail-gallery-main-img');
    const thumbsContainer = document.getElementById('detail-gallery-thumbs');

    if (mainImgEl) {
      mainImgEl.src = photos[0];
      mainImgEl.alt = v.title;
    }

    if (thumbsContainer) {
      thumbsContainer.innerHTML = photos.map((p, idx) => `
        <div class="gallery-thumb ${idx === 0 ? 'active' : ''}" onclick="VehicleDetail.switchPhoto('${p}', this)">
          <img src="${p}" alt="${v.title}">
        </div>
      `).join('');
    }

    // Header info
    document.getElementById('detail-title').textContent = v.title;
    document.getElementById('detail-location').textContent = `${v.location_city} • ${v.location_address}`;
    document.getElementById('detail-rating').textContent = v.rating.toFixed(1);
    document.getElementById('detail-trips-count').textContent = `${v.trip_count || 12} trips`;
    document.getElementById('detail-desc').textContent = v.description;

    // Specs
    document.getElementById('detail-fuel').textContent = v.fuel_type;
    document.getElementById('detail-transmission').textContent = v.transmission;
    document.getElementById('detail-seating').textContent = `${v.seating} Persons`;
    document.getElementById('detail-mileage').textContent = v.mileage || 'Clean Drive';
    document.getElementById('detail-reg-num').textContent = v.reg_number;
    document.getElementById('detail-deposit').textContent = `₹${v.security_deposit.toLocaleString('en-IN')}`;

    // Features Checklist
    const featuresContainer = document.getElementById('detail-features-list');
    if (featuresContainer) {
      featuresContainer.innerHTML = (v.features || []).map(f => `
        <div class="spec-chip" style="padding: 0.4rem 0.75rem;">
          <i class="fas fa-check-circle" style="color: var(--accent-emerald);"></i>
          <span>${f}</span>
        </div>
      `).join('');
    }

    // Owner card
    const ownerAvatar = document.getElementById('detail-owner-avatar');
    if (ownerAvatar) ownerAvatar.src = v.owner_avatar || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80';
    document.getElementById('detail-owner-name').textContent = v.owner_name || 'Verified Host';
    const ownerBadge = document.getElementById('detail-owner-badge');
    if (ownerBadge) {
      ownerBadge.className = `badge ${v.owner_kyc_status === 'VERIFIED' ? 'badge-verified' : 'badge-pending'}`;
      ownerBadge.innerHTML = `<i class="fas fa-shield-alt"></i> ${v.owner_kyc_status || 'VERIFIED'}`;
    }

    // Reviews list
    const reviewsContainer = document.getElementById('detail-reviews-list');
    if (reviewsContainer) {
      if (v.reviews && v.reviews.length > 0) {
        reviewsContainer.innerHTML = v.reviews.map(r => `
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.85rem; margin-bottom: 0.65rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <img src="${r.customer_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'}" style="width: 26px; height: 26px; border-radius: 50%; object-fit: cover;">
                <strong style="font-size: 0.85rem;">${r.customer_name}</strong>
              </div>
              <div style="color: #FBBF24; font-size: 0.75rem;">
                ${'★'.repeat(Math.round(r.rating))}
              </div>
            </div>
            <p style="font-size: 0.825rem; color: var(--text-muted); line-height: 1.4;">${r.comment}</p>
          </div>
        `).join('');
      } else {
        reviewsContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-dim);">No customer reviews yet. Be the first to rent this vehicle!</p>`;
      }
    }
  },

  switchPhoto(src, thumbEl) {
    const mainImgEl = document.getElementById('detail-gallery-main-img');
    if (mainImgEl) mainImgEl.src = src;

    document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
    if (thumbEl) thumbEl.classList.add('active');
  },

  setDurationType(type) {
    this.calcState.durationType = type;

    const btnDaily = document.getElementById('calc-tab-daily');
    const btnHourly = document.getElementById('calc-tab-hourly');
    const countLabel = document.getElementById('calc-count-label');
    const countInput = document.getElementById('calc-count-input');

    if (type === 'hours') {
      btnDaily?.classList.remove('active');
      btnHourly?.classList.add('active');
      if (countLabel) countLabel.textContent = 'Number of Hours:';
      if (countInput) {
        countInput.value = 6;
        countInput.max = 48;
        this.calcState.durationCount = 6;
      }
    } else {
      btnDaily?.classList.add('active');
      btnHourly?.classList.remove('active');
      if (countLabel) countLabel.textContent = 'Number of Days:';
      if (countInput) {
        countInput.value = 2;
        countInput.max = 30;
        this.calcState.durationCount = 2;
      }
    }

    this.recalculate();
  },

  async recalculate() {
    if (!this.currentVehicle) return;

    const countInput = document.getElementById('calc-count-input');
    const count = parseFloat(countInput?.value) || 1;
    const addons = this.getSelectedAddons();

    try {
      const res = await api.post('/bookings/calculate', {
        vehicleId: this.currentVehicle.id,
        durationType: this.calcState.durationType,
        durationCount: this.calcState.durationCount,
        addons
      });

      const c = res.calculation;

      // Update Breakdown DOM
      document.getElementById('calc-base-label').textContent = `Base Fare (${c.durationCount} ${c.durationType}):`;
      document.getElementById('calc-base-amount').textContent = `₹${c.baseAmount.toLocaleString('en-IN')}`;

      // Optional Add-ons row
      const addonsRow = document.getElementById('calc-addons-row');
      const addonsAmt = document.getElementById('calc-addons-amount');
      if (addonsRow && addonsAmt) {
        if (c.addonsTotal > 0) {
          addonsRow.style.display = 'flex';
          addonsAmt.textContent = `₹${c.addonsTotal.toLocaleString('en-IN')}`;
        } else {
          addonsRow.style.display = 'none';
        }
      }

      document.getElementById('calc-shield-amount').textContent = `₹${c.damageProtectionFee.toLocaleString('en-IN')}`;
      document.getElementById('calc-cgst-amount').textContent = `₹${c.gstCgst.toFixed(2)}`;
      document.getElementById('calc-sgst-amount').textContent = `₹${c.gstSgst.toFixed(2)}`;
      document.getElementById('calc-deposit-amount').textContent = `₹${c.securityDeposit.toLocaleString('en-IN')}`;

      document.getElementById('calc-grand-total').textContent = `₹${c.grandTotal.toLocaleString('en-IN')}`;
      document.getElementById('calc-header-rate').textContent = `₹${this.calcState.durationType === 'hours' ? this.currentVehicle.price_per_hour : this.currentVehicle.price_per_day}`;
      document.getElementById('calc-header-unit').textContent = this.calcState.durationType === 'hours' ? '/hour' : '/day';

    } catch (err) {
      console.error('Recalculate error:', err);
    }
  },

  getSelectedAddons() {
    const checked = [];
    document.querySelectorAll('.calc-addon-check:checked').forEach(box => {
      checked.push(box.value);
    });
    return checked;
  },

  async proceedToBooking() {
    const user = api.getUser();

    if (!user) {
      showToast('Please sign in to book this vehicle.', 'warning');
      openModal('modal-auth');
      return;
    }

    if (user.role === 'owner') {
      showToast('You are signed in as an Owner. Switch to Customer to book vehicles.', 'warning');
      return;
    }

    if (user.role === 'admin') {
      showToast('Admin accounts cannot make bookings.', 'warning');
      return;
    }

    const startDate = document.getElementById('calc-start-date')?.value || this.calcState.startDate;
    const endDate = document.getElementById('calc-end-date')?.value || this.calcState.endDate;
    const specialReq = document.getElementById('calc-special-notes')?.value || '';
    const addons = this.getSelectedAddons();

    // Validate rental conditions acceptance
    const termsAgree = document.getElementById('calc-terms-agree');
    const termsErr = document.getElementById('calc-terms-error');
    if (!termsAgree || !termsAgree.checked) {
      if (termsErr) {
        termsErr.textContent = 'Please accept the rental conditions, cancellation policy, and return rules before booking.';
        termsErr.style.display = 'block';
      }
      showToast('Please accept the rental conditions, cancellation policy, and return rules.', 'warning');
      const container = document.getElementById('calc-terms-container');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
        container.style.borderColor = 'var(--accent-rose)';
        setTimeout(() => { container.style.borderColor = 'rgba(6, 182, 212, 0.25)'; }, 2500);
      }
      return;
    }
    if (termsErr) termsErr.style.display = 'none';

    try {
      showToast('Creating booking reservation...', 'warning');

      const res = await api.post('/bookings', {
        vehicleId: this.currentVehicle.id,
        startDate,
        endDate,
        durationType: this.calcState.durationType,
        durationCount: this.calcState.durationCount,
        addons,
        pickupLocation: this.currentVehicle.location_address,
        specialInstructions: specialReq,
        terms_accepted: true
      });

      closeModal(); // Close vehicle detail modal

      // Use RazorpayFlow (real Razorpay) with fallback to demo PaymentFlow
      if (window.RazorpayFlow) {
        await window.RazorpayFlow.initiate(res.booking.id);
      } else if (window.PaymentFlow) {
        window.PaymentFlow.open(res.booking.id);
      }

    } catch (err) {
      showToast(err.message || 'Failed to initiate booking', 'error');
    }
  }
};

window.VehicleDetail = VehicleDetail;
