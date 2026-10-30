/**
 * RideLink Marketplace Controller
 * Vehicle search, category chip filters, price filtering, and card rendering
 */

const Marketplace = {
  vehicles: [],
  filters: {
    category: 'all',
    city: 'all',
    search: '',
    minPrice: 0,
    maxPrice: 15000,
    fuel: 'all',
    transmission: 'all',
    sort: 'newest'
  },

  init() {
    this.bindEvents();
    this.loadVehicles();
  },

  bindEvents() {
    // 1. Category Chips
    document.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.filters.category = chip.dataset.category || 'all';
        this.loadVehicles();
      });
    });

    // 2. Search Bar in Hero
    const heroSearchBtn = document.getElementById('btn-hero-search');
    if (heroSearchBtn) {
      heroSearchBtn.addEventListener('click', () => {
        const cityVal = document.getElementById('hero-city-select')?.value || 'all';
        const queryVal = document.getElementById('hero-query-input')?.value || '';
        this.filters.city = cityVal;
        this.filters.search = queryVal.trim();
        this.loadVehicles();
        // Scroll to results
        document.getElementById('marketplace-results')?.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // 3. Price Slider
    const priceSlider = document.getElementById('filter-price-slider');
    const priceLabel = document.getElementById('filter-price-max-label');
    if (priceSlider && priceLabel) {
      priceSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        priceLabel.textContent = `₹${parseInt(val).toLocaleString('en-IN')}`;
        this.filters.maxPrice = val;
      });
      priceSlider.addEventListener('change', () => {
        this.loadVehicles();
      });
    }

    // 4. Transmission Radio Options
    document.querySelectorAll('input[name="filter-transmission"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.filters.transmission = e.target.value;
        this.loadVehicles();
      });
    });

    // 5. Fuel Type Radio Options
    document.querySelectorAll('input[name="filter-fuel"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.filters.fuel = e.target.value;
        this.loadVehicles();
      });
    });

    // 6. Sort Select
    const sortSelect = document.getElementById('market-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.filters.sort = e.target.value;
        this.loadVehicles();
      });
    }

    // 7. Reset Filters Button
    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetFilters();
      });
    }
  },

  resetFilters() {
    this.filters = {
      category: 'all',
      city: 'all',
      search: '',
      minPrice: 0,
      maxPrice: 15000,
      fuel: 'all',
      transmission: 'all',
      sort: 'newest'
    };

    // Reset UI
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.cat-chip[data-category="all"]')?.classList.add('active');

    const heroCity = document.getElementById('hero-city-select');
    if (heroCity) heroCity.value = 'all';

    const heroQuery = document.getElementById('hero-query-input');
    if (heroQuery) heroQuery.value = '';

    const priceSlider = document.getElementById('filter-price-slider');
    const priceLabel = document.getElementById('filter-price-max-label');
    if (priceSlider) priceSlider.value = 15000;
    if (priceLabel) priceLabel.textContent = '₹15,000';

    const transAll = document.querySelector('input[name="filter-transmission"][value="all"]');
    if (transAll) transAll.checked = true;

    const fuelAll = document.querySelector('input[name="filter-fuel"][value="all"]');
    if (fuelAll) fuelAll.checked = true;

    this.loadVehicles();
  },

  async loadVehicles() {
    const grid = document.getElementById('vehicles-grid-container');
    const countEl = document.getElementById('market-results-count-num');
    if (!grid) return;

    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
        <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent-cyan);"></i>
        <p style="margin-top: 1rem; color: var(--text-muted);">Finding available vehicles...</p>
      </div>
    `;

    try {
      const res = await api.get('/vehicles', this.filters);
      this.vehicles = res.vehicles || [];

      if (countEl) countEl.textContent = this.vehicles.length;

      if (this.vehicles.length === 0) {
        grid.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-car-side"></i>
            <h3>No vehicles found</h3>
            <p>Try adjusting your search location, price range, or category filter to discover more vehicles.</p>
            <button class="btn btn-outline" onclick="Marketplace.resetFilters()">
              <i class="fas fa-redo"></i> Reset All Filters
            </button>
          </div>
        `;
        return;
      }

      grid.innerHTML = this.vehicles.map(v => this.renderCard(v)).join('');

      // Bind card action buttons
      grid.querySelectorAll('.btn-view-vehicle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const vid = btn.dataset.id;
          if (window.VehicleDetail) window.VehicleDetail.open(vid);
        });
      });

      grid.querySelectorAll('.btn-quick-book').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const vid = btn.dataset.id;
          if (window.VehicleDetail) window.VehicleDetail.open(vid, true);
        });
      });

      grid.querySelectorAll('.vehicle-card').forEach(card => {
        card.addEventListener('click', () => {
          const vid = card.dataset.id;
          if (window.VehicleDetail) window.VehicleDetail.open(vid);
        });
      });

    } catch (err) {
      grid.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle" style="color: var(--accent-rose);"></i>
          <h3>Failed to load vehicles</h3>
          <p>${err.message}</p>
          <button class="btn btn-primary" onclick="Marketplace.loadVehicles()">Retry</button>
        </div>
      `;
    }
  },

  renderCard(v) {
    const mainPhoto = (v.photos && v.photos.length > 0) ? v.photos[0] : '/assets/vehicle-ev-suv.jpg';
    const isElectric = v.category === 'Electric' || (v.fuel_type && v.fuel_type.toLowerCase().includes('electric'));

    let categoryBadge = `<span class="vehicle-badge-category">${v.category}</span>`;
    if (isElectric) {
      categoryBadge = `<span class="vehicle-badge-category badge-electric"><i class="fas fa-bolt"></i> EV Clean</span>`;
    }

    return `
      <div class="vehicle-card" data-id="${v.id}">
        <div class="vehicle-media">
          <img src="${mainPhoto}" alt="${v.title}" class="vehicle-img" loading="lazy" onerror="this.src='/assets/vehicle-ev-suv.jpg'">
          ${categoryBadge}
          <div class="vehicle-rating-pill">
            <i class="fas fa-star"></i>
            <span>${v.rating.toFixed(1)}</span>
          </div>
        </div>

        <div class="vehicle-card-body">
          <div class="vehicle-title-wrap">
            <h3 class="vehicle-card-title">${v.title}</h3>
            <div class="vehicle-location">
              <i class="fas fa-map-marker-alt" style="color: var(--accent-cyan);"></i>
              <span>${v.location_city} • ${v.location_address.split(',')[0]}</span>
            </div>
          </div>

          <div class="vehicle-specs-row">
            <div class="spec-chip">
              <i class="fas fa-cogs"></i>
              <span>${v.transmission}</span>
            </div>
            <div class="spec-chip">
              <i class="fas fa-gas-pump"></i>
              <span>${v.fuel_type.split(' ')[0]}</span>
            </div>
            <div class="spec-chip">
              <i class="fas fa-users"></i>
              <span>${v.seating} Seats</span>
            </div>
            <div class="spec-chip">
              <i class="fas fa-tachometer-alt"></i>
              <span>${v.mileage || 'Clean Drive'}</span>
            </div>
          </div>

          <div class="vehicle-card-footer">
            <div class="vehicle-price-box">
              <div class="vehicle-price-num">₹${v.price_per_day.toLocaleString('en-IN')}</div>
              <div class="vehicle-price-sub">per day • ₹${v.price_per_hour}/hr</div>
            </div>

            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-outline btn-sm btn-view-vehicle" data-id="${v.id}" title="View details & photos">
                <i class="fas fa-eye"></i> Details
              </button>
              <button class="btn btn-primary btn-sm btn-quick-book" data-id="${v.id}">
                <i class="fas fa-key"></i> Rent
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};

window.Marketplace = Marketplace;
document.addEventListener('DOMContentLoaded', () => Marketplace.init());
