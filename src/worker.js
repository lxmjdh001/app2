const db = require('./db');
const { startDispatcher, stopDispatcher } = require('./services/postbackDispatcher');

console.log('postback-saas worker started');
startDispatcher();

async function shutdown(signal) {
  console.log(`${signal} received, shutting down worker...`);
  stopDispatcher();
  await db.pool.end();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
