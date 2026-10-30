/**
 * RideLink API Client
 * Centralized fetch wrapper with JWT token handling and error management
 */

const API_BASE = '/api';

const api = {
  getToken() {
    return localStorage.getItem('ridelink_token') || null;
  },

  getUser() {
    const raw = localStorage.getItem('ridelink_user');
    try {
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  setSession(token, user) {
    if (token) localStorage.setItem('ridelink_token', token);
    if (user) localStorage.setItem('ridelink_user', JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('ridelink:auth-change', { detail: { user } }));
  },

  clearSession() {
    localStorage.removeItem('ridelink_token');
    localStorage.removeItem('ridelink_user');
    window.dispatchEvent(new CustomEvent('ridelink:auth-change', { detail: { user: null } }));
  },

  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/demo-login')) {
          this.clearSession();
        }
        const error = new Error(data.message || `Request failed with status ${response.status}`);
        error.data = data;
        error.status = response.status;
        throw error;
      }

      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  get(endpoint, params = null) {
    let url = endpoint;
    if (params) {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          search.append(k, v);
        }
      });
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }
    return this.request(url, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body || {})
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body || {})
    });
  },

  patch(endpoint, body) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body || {})
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

window.api = api;
