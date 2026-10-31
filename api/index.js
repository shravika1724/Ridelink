/**
 * Vercel Serverless Function Entry Point for RideLink
 * Routes all /api/* requests to the Express application.
 */
process.env.VERCEL = process.env.VERCEL || '1';
const app = require('../server/server');

module.exports = app;
