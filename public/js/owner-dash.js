/**
 * RideLink Vehicle Owner Dashboard Controller
 * Host fleet management, add vehicle modal, booking request approvals, and bank payout settings
 */

const OwnerDash = {
  stats: null,
  vehicles: [],
  bookings: [],
  bankDetails: null,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Owner Tabs
    document.querySelectorAll('.owner-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.owner-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.owner-tab-pane').forEach(p => {
          p.classList.remove('active');
          p.style.display = 'none';
        });

        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.pane);
        if (target) {
          target.classList.add('active');
          target.style.display = 'block';
        }
      });
    });

    // Add Vehicle Form Submit
    const addVehicleForm = document.getElementById('form-add-vehicle');
    if (addVehicleForm) {
      addVehicleForm.addEventListener('submit', (e) => this.handleAddVehicle(e));
    }

    // Bank Details Form Submit
    const bankForm = document.getElementById('form-bank-details');
    if (bankForm) {
      bankForm.addEventListener('submit', (e) => this.handleUpdateBank(e));
    }

    // Profile Form Submit
    const profileForm = document.getElementById('form-owner-profile');
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => this.handleUpdateProfile(e));
    }
  },

  async loadData() {
    const user = api.getUser();
    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      showToast('Owner access required', 'warning');
      navigateTo('marketplace');
      return;
    }

    try {
      // 1. Fetch Stats
      const statsRes = await api.get('/owner/stats');
      this.stats = statsRes.stats;
      this.renderStats();

      // 2. Fetch Fleet
      const vehiclesRes = await api.get('/owner/vehicles');
      this.vehicles = vehiclesRes.vehicles || [];
      this.renderVehicles();

      // 3. Fetch Booking Requests
      const bookingsRes = await api.get('/owner/bookings');
      this.bookings = bookingsRes.bookings || [];
      this.renderBookings();

      // 4. Fetch Bank Details
      const bankRes = await api.get('/owner/bank-details');
      this.bankDetails = bankRes.bankDetails;
      this.renderBankDetails();

      // 5. Fetch Earnings Chart Data
      const chartRes = await api.get('/owner/earnings-chart');
      this.renderEarningsChart(chartRes.chartData || []);

      // 6. Pre-fill profile fields
      this.populateProfileForm();

    } catch (err) {
      console.error('Owner dash load error:', err);
    }
  },

  renderStats() {
    const s = this.stats;
    if (!s) return;

    document.getElementById('owner-kpi-net-earnings').textContent = `₹${s.netPayout.toLocaleString('en-IN')}`;
    document.getElementById('owner-kpi-gross-earnings').textContent = `Gross ₹${s.grossEarnings.toLocaleString('en-IN')} (10% platform fee: ₹${s.platformCommission})`;
    document.getElementById('owner-kpi-total-fleet').textContent = s.totalVehicles;
    document.getElementById('owner-kpi-available-fleet').textContent = `${s.availableVehicles} active available`;
    document.getElementById('owner-kpi-total-trips').textContent = s.totalBookings;
    document.getElementById('owner-kpi-rating').textContent = `${s.averageRating} ★`;
  },

  renderEarningsChart(data) {
    const chartContainer = document.getElementById('owner-earnings-chart-container');
    if (!chartContainer || !data || data.length === 0) return;

    const maxVal = Math.max(...data.map(d => d.gross), 40000);

    chartContainer.innerHTML = `
      <div style="display: flex; align-items: flex-end; justify-content: space-between; height: 160px; padding-top: 1rem; gap: 0.75rem;">
        ${data.map(d => {
      const heightPct = Math.round((d.gross / maxVal) * 100);
      return `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; height: 100%; justify-content: flex-end;">
              <div style="font-size: 0.7rem; font-weight: 700; color: var(--accent-emerald);">₹${(d.net / 1000).toFixed(1)}k</div>
              <div style="
                width: 100%;
                max-width: 36px;
                height: ${heightPct}%;
                background: linear-gradient(180deg, var(--accent-cyan) 0%, var(--accent-emerald) 100%);
                border-radius: 6px 6px 2px 2px;
                box-shadow: 0 4px 12px rgba(6, 182, 212, 0.25);
                transition: height 0.5s ease;
                cursor: pointer;
              " title="${d.month}: Gross ₹${d.gross.toLocaleString('en-IN')}, Net ₹${d.net.toLocaleString('en-IN')} (${d.trips} trips)"></div>
              <div style="font-size: 0.75rem; color: var(--text-dim); font-weight: 600;">${d.month}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  },

  renderVehicles() {
    const container = document.getElementById('owner-vehicles-grid');
    if (!container) return;

    if (this.vehicles.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i class="fas fa-car"></i>
          <h3>No vehicles listed yet</h3>
          <p>Start earning by listing your unused or partially used car, bike, or EV on RideLink.</p>
          <button class="btn btn-emerald" onclick="openModal('modal-add-vehicle')">
            <i class="fas fa-plus-circle"></i> Add Your First Vehicle
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = this.vehicles.map(v => {
      const photo = (v.photos && v.photos.length > 0) ? v.photos[0] : '/assets/vehicle-ev-suv.jpg';
      const isAvailable = v.availability_status === 'AVAILABLE';

      return `
        <div class="fleet-card">
          <div class="fleet-card-media">
            <img src="${photo}" alt="${v.title}">
            <span class="badge ${isAvailable ? 'badge-verified' : 'badge-pending'}" style="position: absolute; top: 0.75rem; right: 0.75rem;">
              ${v.availability_status}
            </span>
          </div>

          <div class="fleet-card-body">
            <div>
              <h4 style="font-family: var(--font-heading); font-size: 1.05rem;">${v.title}</h4>
              <p style="font-size: 0.8rem; color: var(--text-dim);">${v.reg_number} • ${v.location_city}</p>
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted);">
              <span>Daily Rate: <strong style="color: var(--accent-emerald);">₹${v.price_per_day}</strong></span>
              <span>Hourly: <strong>₹${v.price_per_hour}</strong></span>
            </div>

            <div class="fleet-actions">
              <button class="btn btn-outline btn-sm" onclick="OwnerDash.toggleAvailability(${v.id}, '${isAvailable ? 'MAINTENANCE' : 'AVAILABLE'}')">
                <i class="fas fa-toggle-${isAvailable ? 'on' : 'off'}"></i> ${isAvailable ? 'Set Inactive' : 'Set Available'}
              </button>

              <button class="btn btn-danger btn-sm" onclick="OwnerDash.deleteVehicle(${v.id})">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderBookings() {
    const tableBody = document.getElementById('owner-bookings-table-body');
    if (!tableBody) return;

    if (this.bookings.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem;">
            No incoming booking requests yet.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = this.bookings.map(b => {
      let statusBadge = `<span class="badge badge-confirmed">${b.status}</span>`;
      if (b.status === 'PENDING') statusBadge = `<span class="badge badge-pending">PENDING</span>`;
      if (b.status === 'ACTIVE') statusBadge = `<span class="badge badge-electric">ACTIVE TRIP</span>`;
      if (b.status === 'COMPLETED') statusBadge = `<span class="badge badge-completed">COMPLETED</span>`;

      return `
        <tr>
          <td>
            <strong>${b.booking_code}</strong>
          </td>
          <td>
            <div class="cell-flex">
              <div>
                <strong>${b.vehicle_title}</strong>
                <div style="font-size: 0.75rem; color: var(--text-dim);">${b.reg_number}</div>
              </div>
            </div>
          </td>
          <td>
            <strong>${b.customer_name}</strong>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${b.customer_phone}</div>
          </td>
          <td>
            <div>${b.start_date} to ${b.end_date}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${b.duration_count} ${b.duration_type}</div>
          </td>
          <td>
            <strong style="color: var(--accent-emerald);">₹${b.total_amount.toLocaleString('en-IN')}</strong>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${b.payment_status || 'PAID'}</div>
          </td>
          <td>${statusBadge}</td>
          <td>
              <button class="btn btn-outline btn-sm" onclick="ChatReview.openChat(${b.id}, '${b.customer_name}')" title="Message Customer">
                <i class="fas fa-comment"></i>
              </button>

              ${b.status === 'PENDING' ? `
                <button class="btn btn-emerald btn-sm" onclick="OwnerDash.updateBookingStatus(${b.id}, 'CONFIRMED')" title="Accept">
                  <i class="fas fa-check"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="OwnerDash.updateBookingStatus(${b.id}, 'CANCELLED')" title="Reject">
                  <i class="fas fa-times"></i>
                </button>
              ` : ''}

              ${b.status === 'CONFIRMED' ? `
                <button class="btn btn-primary btn-sm" onclick="OwnerDash.updateBookingStatus(${b.id}, 'ACTIVE')" title="Start Trip / Handover Vehicle">
                  <i class="fas fa-key"></i> Handover
                </button>
              ` : ''}

              ${b.status === 'ACTIVE' ? `
                <button class="btn btn-emerald btn-sm" onclick="OwnerDash.updateBookingStatus(${b.id}, 'COMPLETED')" title="Mark Trip Finished">
                  <i class="fas fa-flag-checkered"></i> Return
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderBankDetails() {
    const d = this.bankDetails;
    if (!d) return;

    const holderInput = document.getElementById('bank-holder-input');
    const accInput = document.getElementById('bank-acc-input');
    const ifscInput = document.getElementById('bank-ifsc-input');
    const nameInput = document.getElementById('bank-name-input');
    const upiInput = document.getElementById('bank-upi-input');

    if (holderInput) holderInput.value = d.account_holder_name;
    if (accInput) accInput.value = d.account_number_masked;
    if (ifscInput) ifscInput.value = d.ifsc_code;
    if (nameInput) nameInput.value = d.bank_name;
    if (upiInput) upiInput.value = d.upi_id || '';
  },

  async handleAddVehicle(e) {
    e.preventDefault();

    const title = document.getElementById('v-add-title').value;
    const brand = document.getElementById('v-add-brand').value;
    const model = document.getElementById('v-add-model').value;
    const year = document.getElementById('v-add-year').value;
    const category = document.getElementById('v-add-category').value;
    const reg_number = document.getElementById('v-add-reg').value;
    const location_city = document.getElementById('v-add-city').value;
    const location_address = document.getElementById('v-add-address').value;
    const price_per_day = document.getElementById('v-add-price-day').value;
    const price_per_hour = document.getElementById('v-add-price-hr').value;
    const fuel_type = document.getElementById('v-add-fuel').value;
    const transmission = document.getElementById('v-add-transmission').value;
    const seating = document.getElementById('v-add-seating').value;
    const description = document.getElementById('v-add-desc').value;
    const photoDataUrls = VehicleUpload.getPhotoDataUrls();
    const photos = photoDataUrls.length > 0 ? photoDataUrls : ['/assets/vehicle-ev-suv.jpg'];

    const ownerDecl = document.getElementById('v-add-owner-declaration');
    const declErr = document.getElementById('v-add-declaration-error');
    if (!ownerDecl || !ownerDecl.checked) {
      if (declErr) {
        declErr.textContent = 'You must confirm your authorization and declare vehicle accuracy before publishing.';
        declErr.style.display = 'block';
      }
      showToast('You must confirm your authorization and declare vehicle accuracy before publishing.', 'warning');
      ownerDecl?.focus();
      return;
    }
    if (declErr) declErr.style.display = 'none';

    try {
      showToast('Publishing vehicle listing...', 'warning');

      const res = await api.post('/vehicles', {
        title, brand, model, year, category, reg_number,
        location_city, location_address, price_per_day, price_per_hour,
        fuel_type, transmission, seating, description,
        photos: photos,
        owner_declaration: true
      });

      closeModal();
      if (ownerDecl) ownerDecl.checked = false;
      VehicleUpload.reset();
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to list vehicle', 'error');
    }
  },

  async toggleAvailability(vehicleId, newStatus) {
    try {
      const res = await api.patch(`/vehicles/${vehicleId}/status`, { status: newStatus });
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  },

  async deleteVehicle(vehicleId) {
    if (!confirm('Are you sure you want to remove this vehicle from your fleet?')) return;

    try {
      const res = await api.delete(`/vehicles/${vehicleId}`);
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to remove vehicle', 'error');
    }
  },

  async updateBookingStatus(bookingId, status) {
    try {
      const res = await api.patch(`/owner/bookings/${bookingId}/status`, { status });
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to update request', 'error');
    }
  },

  async handleUpdateBank(e) {
    e.preventDefault();

    const accountHolderName = document.getElementById('bank-holder-input').value;
    const accountNumber = document.getElementById('bank-acc-input').value;
    const ifscCode = document.getElementById('bank-ifsc-input').value;
    const bankName = document.getElementById('bank-name-input').value;
    const upiId = document.getElementById('bank-upi-input').value;

    try {
      const res = await api.put('/owner/bank-details', {
        accountHolderName, accountNumber, ifscCode, bankName, upiId
      });
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to save payout info', 'error');
    }
  },

  populateProfileForm() {
    const user = api.getUser();
    if (!user) return;
    const nameEl = document.getElementById('owner-profile-name');
    const phoneEl = document.getElementById('owner-profile-phone');
    const emailEl = document.getElementById('owner-profile-email');
    const avatarEl = document.getElementById('owner-profile-avatar-preview');
    if (nameEl) nameEl.value = user.name || '';
    if (phoneEl) phoneEl.value = user.phone || '';
    if (emailEl) emailEl.value = user.email || '';
    if (avatarEl && user.avatar) avatarEl.src = user.avatar;
  },

  async handleUpdateProfile(e) {
    e.preventDefault();
    const name = document.getElementById('owner-profile-name').value.trim();
    const phone = document.getElementById('owner-profile-phone').value.trim();
    const avatarEl = document.getElementById('owner-profile-avatar-preview');
    const avatar = (avatarEl && avatarEl.dataset.newSrc) ? avatarEl.dataset.newSrc : undefined;

    if (!name || !phone) {
      showToast('Name and phone are required.', 'warning');
      return;
    }

    try {
      showToast('Saving profile...', 'warning');
      const res = await api.put('/auth/update-profile', { name, phone, avatar });
      // Update local storage
      const stored = api.getUser();
      if (stored) {
        stored.name = res.user.name;
        stored.phone = res.user.phone;
        if (res.user.avatar) stored.avatar = res.user.avatar;
        localStorage.setItem('ridelink_user', JSON.stringify(stored));
      }
      showToast(res.message || 'Profile updated!');
      // Refresh header avatar if present
      const headerAvatar = document.querySelector('.dash-avatar-lg');
      if (headerAvatar && res.user.avatar) headerAvatar.src = res.user.avatar;
    } catch (err) {
      showToast(err.message || 'Failed to update profile', 'error');
    }
  }
};

// ── Avatar preview helper (called from inline onchange) ──
const OwnerProfile = {
  onAvatarSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Photo must be under 2 MB.', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const preview = document.getElementById('owner-profile-avatar-preview');
      if (preview) {
        preview.src = ev.target.result;
        preview.dataset.newSrc = ev.target.result; // stored for submit
      }
    };
    reader.readAsDataURL(file);
  }
};
window.OwnerProfile = OwnerProfile;

window.OwnerDash = OwnerDash;
document.addEventListener('DOMContentLoaded', () => OwnerDash.init());
