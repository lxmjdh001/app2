const express = require('express');
const config = require('./config');
const db = require('./db');
const { resolveApp, resolveAdminApp } = require('./middleware');
const { requireJwt } = require('./auth');
const eventsRouter = require('./routes/events');
const publicTrackingRouter = require('./routes/publicTracking');
const authRouter = require('./routes/auth');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', worker_mode: false });
  } catch (error) {
    res.status(500).json({ status: 'error', db: error.message });
  }
});

app.use(authRouter);
app.use(publicTrackingRouter);

app.use('/api', resolveApp, eventsRouter);
app.use('/admin', requireJwt, resolveAdminApp, eventsRouter);

const server = app.listen(config.port, () => {
  console.log(`postback-saas api listening on http://localhost:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down api...`);
  server.close(async () => {
    await db.pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
