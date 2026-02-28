require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const logger = require('./utils/logger');
const { pool } = require('./db');
const redisClient = require('./cache/redis');

const app = express();

// Trust the Nginx proxy upstream (needed for X-Forwarded-For / IP detection)
app.set('trust proxy', 1);

// ── Security & compression ────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// ── Request logging ───────────────────────────────────────
app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
}));

// ── Rate limiting — Redis-backed (shared across all 8 API instances) ──────
// Key by X-Real-IP (the real client IP forwarded by Nginx) so each unique user
// gets their own 600 req/min bucket via Redis — shared across all 8 API replicas.
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,  // 1 min
    max: parseInt(process.env.RATE_LIMIT_MAX) || 600,    // 600 req/min per user IP

    // Redis store: all 8 instances share one counter
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: 'rl:',
    }),

    // Key by real client IP sent by Nginx in X-Real-IP header.
    // Falls back to req.ip only if header is missing.
    keyGenerator: (req) => {
        return req.headers['x-real-ip']
            || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.ip;
    },

    // Skip rate-limiting internal health checks entirely
    skip: (req) => req.path === '/health',

    // Friendly response
    message: {
        status: 'error',
        message: 'Too many requests. Please slow down and try again in a minute.'
    },

    // Include standard headers so clients can back off gracefully
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// ── Health Check ─────────────────────────────────────────
// Reachable via Nginx: location /health { proxy_pass http://backend_servers; }
app.get('/health', async (req, res) => {
    const health = { status: 'ok', api: 'up', db: 'unknown', redis: 'unknown', pid: process.pid, uptime: Math.floor(process.uptime()) };
    let degraded = false;

    // Check DB with a short timeout
    try {
        await Promise.race([
            pool.query('SELECT 1'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 2000))
        ]);
        health.db = 'up';
    } catch (err) {
        health.db = 'down';
        health.dbError = err.message;
        degraded = true;
        logger.warn('Health check: DB unavailable —', err.message);
    }

    // Check Redis with a short timeout
    try {
        const pong = await Promise.race([
            redisClient.ping(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 2000))
        ]);
        health.redis = pong === 'PONG' ? 'up' : 'degraded';
    } catch (err) {
        health.redis = 'down';
        health.redisError = err.message;
        degraded = true;
        logger.warn('Health check: Redis unavailable —', err.message);
    }

    if (degraded) {
        health.status = 'degraded';
        // Return 200-degraded so Nginx keepalive routing still works;
        // use 503 only if BOTH db AND redis are both down (total outage).
        const totalOutage = health.db === 'down' && health.redis === 'down';
        return res.status(totalOutage ? 503 : 200).json(health);
    }

    res.status(200).json(health);
});

// ── Routes ───────────────────────────────────────────────
const compilerRoutes = require('./api/routes/compiler');
app.use('/api/compiler', compilerRoutes);

// ── 404 catch ────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ── Error handling ────────────────────────────────────────
app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ status: 'error', message: 'Something went wrong!' });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    logger.info(`Stateless API Server running on port ${PORT} (PID ${process.pid})`);
});
