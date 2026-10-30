const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const authRoutes = require('./auth');
const vehiclesRoutes = require('./vehicles');
const bookingsRoutes = require('./bookings');
const paymentsRoutes = require('./payments');
const ownerRoutes = require('./owner');
const adminRoutes = require('./admin');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'RideLink API Gateway',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Dedicated Legal & Compliance Routes
app.get(['/terms', '/terms.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/terms.html'));
});

app.get(['/privacy', '/privacy.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy.html'));
});

// Single Page Application fallback for any non-API route
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected server error occurred.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 RideLink Vehicle Sharing & Rental System running at http://localhost:${PORT}`);
});

module.exports = { app, server };
