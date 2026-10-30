/**
 * RideLink Admin Control Center Controller
 * Platform KPIs, KYC Verification Desk, Fleet Moderation, and Bookings Audit
 */

const AdminDash = {
  stats: null,
  users: [],
  kycQueue: [],
  vehicles: [],
  bookings: [],

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Admin Tab Navigation
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.pane);
        if (target) target.classList.add('active');
      });
    });
  },

  async loadData() {
    const user = api.getUser();
    if (!user || user.role !== 'admin') {
      showToast('Admin privilege required', 'warning');
      navigateTo('marketplace');
      return;
    }

    try {
      // 1. Stats
      const statsRes = await api.get('/admin/stats');
      this.stats = statsRes.stats;
      this.renderStats();

      // 2. KYC Queue
      const kycRes = await api.get('/admin/kyc-queue');
      this.kycQueue = kycRes.queue || [];
      this.renderKycQueue();

      // 3. Vehicles
      const vehRes = await api.get('/admin/vehicles');
      this.vehicles = vehRes.vehicles || [];
      this.renderVehicles();

      // 4. Users
      const usersRes = await api.get('/admin/users');
      this.users = usersRes.users || [];
      this.renderUsers();

      // 5. Bookings
      const bookRes = await api.get('/admin/bookings');
      this.bookings = bookRes.bookings || [];
      this.renderBookings();

    } catch (err) {
      console.error('Admin dash load error:', err);
    }
  },

  renderStats() {
    const s = this.stats;
    if (!s) return;

    document.getElementById('admin-kpi-gmv').textContent = `₹${s.gmv.toLocaleString('en-IN')}`;
    document.getElementById('admin-kpi-revenue').textContent = `₹${s.platformRevenue.toLocaleString('en-IN')}`;
    document.getElementById('admin-kpi-fleet').textContent = s.totalVehicles;
    document.getElementById('admin-kpi-users').textContent = s.totalUsers;
    document.getElementById('admin-kpi-pending-kyc').textContent = s.pendingKycCount;
  },

  renderKycQueue() {
    const tableBody = document.getElementById('admin-kyc-table-body');
    if (!tableBody) return;

    if (this.kycQueue.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;">No pending KYC identity reviews.</td></tr>`;
      return;
    }

    tableBody.innerHTML = this.kycQueue.map(u => {
      let badge = `<span class="badge badge-verified">VERIFIED</span>`;
      if (u.kyc_status === 'PENDING') badge = `<span class="badge badge-pending">PENDING</span>`;
      if (u.kyc_status === 'REJECTED') badge = `<span class="badge badge-rejected">REJECTED</span>`;

      return `
        <tr>
          <td>
            <div class="cell-flex">
              <img src="${u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'}" class="cell-thumb" style="border-radius: 50%;">
              <div>
                <strong>${u.name}</strong>
                <div style="font-size: 0.75rem; color: var(--text-dim);">${u.email}</div>
              </div>
            </div>
          </td>
          <td><span class="badge badge-electric">${u.role.toUpperCase()}</span></td>
          <td>
            <div><strong>${u.dl_number_masked || 'None'}</strong></div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${u.dl_doc_name || 'dl_scan.pdf'}</div>
          </td>
          <td>
            <div><strong>${u.aadhaar_number_masked || 'None'}</strong></div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${u.aadhaar_doc_name || 'aadhaar_scan.pdf'}</div>
          </td>
          <td>${badge}</td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-emerald btn-sm" onclick="AdminDash.verifyKyc(${u.id}, 'VERIFIED')" title="Approve Identity">
                <i class="fas fa-check"></i> Approve
              </button>
              <button class="btn btn-danger btn-sm" onclick="AdminDash.verifyKyc(${u.id}, 'REJECTED')" title="Reject Identity">
                <i class="fas fa-times"></i> Reject
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderVehicles() {
    const tableBody = document.getElementById('admin-vehicles-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = this.vehicles.map(v => {
      const isLive = v.is_approved === 1;

      return `
        <tr>
          <td>
            <div class="cell-flex">
              <img src="${v.photos[0] || '/assets/vehicle-ev-suv.jpg'}" class="cell-thumb">
              <div>
                <strong>${v.title}</strong>
                <div style="font-size: 0.75rem; color: var(--text-dim);">${v.category} • ${v.reg_number}</div>
              </div>
            </div>
          </td>
          <td>${v.owner_name}</td>
          <td>${v.location_city}</td>
          <td><strong>₹${v.price_per_day}</strong>/day</td>
          <td>
            <span class="badge ${isLive ? 'badge-verified' : 'badge-rejected'}">
              ${isLive ? 'LIVE' : 'SUSPENDED'}
            </span>
          </td>
          <td>
            <button class="btn ${isLive ? 'btn-danger' : 'btn-emerald'} btn-sm" onclick="AdminDash.toggleVehicleApproval(${v.id}, ${!isLive})">
              <i class="fas fa-${isLive ? 'ban' : 'check'}"></i> ${isLive ? 'Suspend' : 'Approve'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderUsers() {
    const tableBody = document.getElementById('admin-users-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = this.users.map(u => `
      <tr>
        <td>
          <div class="cell-flex">
            <img src="${u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'}" class="cell-thumb" style="border-radius: 50%;">
            <div>
              <strong>${u.name}</strong>
              <div style="font-size: 0.75rem; color: var(--text-dim);">${u.email}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-electric">${u.role.toUpperCase()}</span></td>
        <td>${u.phone}</td>
        <td>
          <span class="badge ${u.kyc_status === 'VERIFIED' ? 'badge-verified' : 'badge-pending'}">
            ${u.kyc_status}
          </span>
        </td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
      </tr>
    `).join('');
  },

  renderBookings() {
    const tableBody = document.getElementById('admin-bookings-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = this.bookings.map(b => `
      <tr>
        <td><strong>${b.booking_code}</strong></td>
        <td>${b.customer_name}</td>
        <td>${b.vehicle_title}</td>
        <td>${b.start_date} to ${b.end_date}</td>
        <td><strong style="color: var(--accent-emerald);">₹${b.total_amount.toLocaleString('en-IN')}</strong></td>
        <td><span class="badge badge-confirmed">${b.status}</span></td>
        <td>
          ${b.invoice_number ? `
            <button class="btn btn-outline btn-sm" onclick="PaymentFlow.showTaxInvoice('${b.invoice_number}')">
              <i class="fas fa-file-invoice"></i> Invoice
            </button>
          ` : '-'}
        </td>
      </tr>
    `).join('');
  },

  async verifyKyc(userId, status) {
    try {
      const res = await api.patch(`/admin/kyc/${userId}/verify`, { status });
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to update KYC status', 'error');
    }
  },

  async toggleVehicleApproval(vehicleId, isApproved) {
    try {
      const res = await api.patch(`/admin/vehicles/${vehicleId}/approval`, { isApproved });
      showToast(res.message);
      this.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to update vehicle approval', 'error');
    }
  }
};

window.AdminDash = AdminDash;
document.addEventListener('DOMContentLoaded', () => AdminDash.init());
