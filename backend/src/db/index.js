const { Pool } = require('pg');
const logger = require('../utils/logger');

// Each API replica runs with max:50 connections to PgBouncer.
// 8 replicas × 50 = 400 connections → PgBouncer DEFAULT_POOL_SIZE=400 covers this.
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'coderunner',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',

  max: 50,    // was 20 — 50 per replica × 8 replicas = 400 total
  idleTimeoutMillis: 30000,    // close idle clients after 30s
  connectionTimeoutMillis: 3000,  // fail fast on connection timeout (was 2s)
  allowExitOnIdle: true, // let Node exit when pool is empty
});

pool.on('connect', () => {
  logger.debug('New client connected to PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('Database query error:', { text, err: err.message });
    throw err;
  }
};

const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
