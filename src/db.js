const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: config.databaseUrl
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
};
