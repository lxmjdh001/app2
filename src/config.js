const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

module.exports = {
  port: toInt(process.env.PORT, 8088),
  databaseUrl: process.env.DATABASE_URL,
  localDevAllowAnon: toBool(process.env.LOCAL_DEV_ALLOW_ANON, false),

  dispatchIntervalMs: toInt(process.env.DISPATCH_INTERVAL_MS, 3000),
  dispatchBatchSize: toInt(process.env.DISPATCH_BATCH_SIZE, 20),
  maxJobAttempts: toInt(process.env.MAX_JOB_ATTEMPTS, 6),

  facebookApiVersion: process.env.FACEBOOK_API_VERSION || 'v21.0',
  tiktokEndpoint: process.env.TIKTOK_ENDPOINT || 'https://business-api.tiktok.com/open_api/v1.3/event/track/',

  defaultAttributionLookbackHours: toInt(process.env.DEFAULT_ATTRIBUTION_LOOKBACK_HOURS, 168),
  defaultAttributionRuleName: process.env.DEFAULT_ATTRIBUTION_RULE_NAME || 'last_touch_v1',

  clickhouseEnabled: toBool(process.env.CLICKHOUSE_ENABLED, false),
  clickhouseUrl: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
  clickhouseDatabase: process.env.CLICKHOUSE_DATABASE || 'postback_analytics',
  clickhouseUsername: process.env.CLICKHOUSE_USERNAME || 'default',
  clickhousePassword: process.env.CLICKHOUSE_PASSWORD || '',
  clickhouseRequestTimeoutMs: toInt(process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS, 15000),

  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h'
};
