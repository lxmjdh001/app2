const db = require('./db');
const config = require('./config');
const { ensureClickHouseSchema } = require('./services/clickhouseService');

const ddl = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS apps (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS app_user_roles (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'analyst', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_configs (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  endpoint_url TEXT,
  access_token TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, platform)
);

CREATE TABLE IF NOT EXISTS platform_pixels (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok')),
  display_name TEXT NOT NULL,
  pixel_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  endpoint_url TEXT,
  access_token TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, platform, pixel_key)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  event_uid TEXT,
  oa_uid TEXT,
  ifa TEXT,
  sdk_protocol_version TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS event_uid TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS oa_uid TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ifa TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sdk_protocol_version TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE TABLE IF NOT EXISTS postback_jobs (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok')),
  platform_event_name TEXT,
  dedupe_key TEXT,
  attribution_key_id UUID,
  attribution_rule_version INT,
  platform_pixel_id BIGINT REFERENCES platform_pixels(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'retry', 'done', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_status INT,
  response_body TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE postback_jobs ADD COLUMN IF NOT EXISTS platform_event_name TEXT;
ALTER TABLE postback_jobs ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE postback_jobs ADD COLUMN IF NOT EXISTS attribution_key_id UUID;
ALTER TABLE postback_jobs ADD COLUMN IF NOT EXISTS attribution_rule_version INT;
ALTER TABLE postback_jobs ADD COLUMN IF NOT EXISTS platform_pixel_id BIGINT;

CREATE TABLE IF NOT EXISTS attribution_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  source_platform TEXT NOT NULL DEFAULT 'unknown' CHECK (source_platform IN ('facebook', 'tiktok', 'unknown')),
  click_id TEXT,
  ttclid TEXT,
  fbc TEXT,
  campaign TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (click_id IS NOT NULL OR ttclid IS NOT NULL OR fbc IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS click_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  click_id TEXT NOT NULL,
  ttclid TEXT,
  fbc TEXT,
  source_platform TEXT NOT NULL DEFAULT 'unknown',
  campaign TEXT,
  redirect_url TEXT NOT NULL,
  request_ip TEXT,
  user_agent TEXT,
  query_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attribution_rules (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version INT NOT NULL,
  rule_name TEXT NOT NULL,
  lookback_window_hours INT NOT NULL DEFAULT 168,
  click_priority TEXT[] NOT NULL DEFAULT ARRAY['click_id','ttclid','fbc'],
  allow_event_side_create BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, version)
);

CREATE TABLE IF NOT EXISTS event_name_mappings (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok')),
  internal_event_name TEXT NOT NULL,
  platform_event_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, platform, internal_event_name)
);

CREATE TABLE IF NOT EXISTS event_deduplications (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok')),
  dedupe_key TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  attribution_key_id UUID REFERENCES attribution_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, platform, dedupe_key)
);

CREATE TABLE IF NOT EXISTS attribution_sql_queries (
  id BIGSERIAL PRIMARY KEY,
  app_id BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  query_name TEXT NOT NULL,
  version INT NOT NULL,
  sql_template TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, query_name, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'postback_jobs_attribution_key_id_fkey'
  ) THEN
    ALTER TABLE postback_jobs
      ADD CONSTRAINT postback_jobs_attribution_key_id_fkey
      FOREIGN KEY (attribution_key_id)
      REFERENCES attribution_keys(id)
      ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'postback_jobs_platform_pixel_id_fkey'
  ) THEN
    ALTER TABLE postback_jobs
      ADD CONSTRAINT postback_jobs_platform_pixel_id_fkey
      FOREIGN KEY (platform_pixel_id)
      REFERENCES platform_pixels(id)
      ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users (username);

CREATE INDEX IF NOT EXISTS idx_user_roles_user
  ON app_user_roles (user_id, app_id);

CREATE INDEX IF NOT EXISTS idx_jobs_dispatch
  ON postback_jobs (status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_event
  ON postback_jobs (event_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_jobs_rule_version
  ON postback_jobs (attribution_rule_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_platform_pixel
  ON postback_jobs (platform_pixel_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_app_time
  ON events (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_event_uid
  ON events (app_id, event_uid)
  WHERE event_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attribution_click_unique
  ON attribution_keys (app_id, click_id)
  WHERE click_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attribution_ttclid_unique
  ON attribution_keys (app_id, ttclid)
  WHERE ttclid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attribution_fbc_unique
  ON attribution_keys (app_id, fbc)
  WHERE fbc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_click_events_time
  ON click_events (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_click_events_click_id
  ON click_events (app_id, click_id);

CREATE INDEX IF NOT EXISTS idx_attribution_rules_active
  ON attribution_rules (app_id, is_active, version DESC);

CREATE INDEX IF NOT EXISTS idx_event_dedupe_lookup
  ON event_deduplications (app_id, platform, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_platform_pixels_lookup
  ON platform_pixels (app_id, platform, enabled, priority, id);

INSERT INTO platform_pixels
  (app_id, platform, display_name, pixel_key, enabled, endpoint_url, access_token, config_json, priority)
SELECT
  pc.app_id,
  pc.platform,
  'default',
  COALESCE(pc.config_json->>'pixel_id', pc.config_json->>'pixel_code'),
  pc.enabled,
  pc.endpoint_url,
  pc.access_token,
  pc.config_json,
  100
FROM platform_configs pc
WHERE COALESCE(pc.config_json->>'pixel_id', pc.config_json->>'pixel_code') IS NOT NULL
ON CONFLICT (app_id, platform, pixel_key)
DO NOTHING;

INSERT INTO event_name_mappings (app_id, platform, internal_event_name, platform_event_name, is_active)
SELECT
  a.id,
  defaults.platform,
  defaults.internal_event_name,
  defaults.platform_event_name,
  TRUE
FROM apps a
CROSS JOIN (
  VALUES
    ('facebook', 'register', 'CompleteRegistration'),
    ('facebook', 'signup', 'CompleteRegistration'),
    ('facebook', 'ftd', 'Purchase'),
    ('facebook', 'deposit', 'Purchase'),
    ('facebook', 'install_open', 'MobileAppInstall'),
    ('facebook', 'install', 'MobileAppInstall'),
    ('facebook', 'first_open', 'MobileAppInstall'),
    ('tiktok', 'register', 'CompleteRegistration'),
    ('tiktok', 'signup', 'CompleteRegistration'),
    ('tiktok', 'ftd', 'Purchase'),
    ('tiktok', 'deposit', 'Purchase'),
    ('tiktok', 'install_open', 'InstallApp'),
    ('tiktok', 'install', 'InstallApp'),
    ('tiktok', 'first_open', 'InstallApp')
) AS defaults(platform, internal_event_name, platform_event_name)
ON CONFLICT (app_id, platform, internal_event_name)
DO NOTHING;

INSERT INTO attribution_rules
  (app_id, version, rule_name, lookback_window_hours, click_priority, allow_event_side_create, is_active)
SELECT
  a.id,
  1,
  '${config.defaultAttributionRuleName}',
  ${config.defaultAttributionLookbackHours},
  ARRAY['click_id','ttclid','fbc'],
  FALSE,
  TRUE
FROM apps a
WHERE NOT EXISTS (
  SELECT 1 FROM attribution_rules r WHERE r.app_id = a.id
)
ON CONFLICT (app_id, version)
DO NOTHING;

UPDATE attribution_rules r
SET is_active = TRUE,
    updated_at = NOW()
WHERE r.is_active = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM attribution_rules x
    WHERE x.app_id = r.app_id
      AND x.is_active = TRUE
  )
  AND r.version = (
    SELECT MAX(version)
    FROM attribution_rules m
    WHERE m.app_id = r.app_id
  );

INSERT INTO attribution_sql_queries (app_id, query_name, version, sql_template, is_active)
SELECT
  a.id,
  'attribution_overview',
  1,
  'SELECT platform, count() AS total_jobs, countIf(status = ''done'') AS done_jobs, round(done_jobs / nullIf(total_jobs, 0), 4) AS done_rate FROM postback_jobs_analytics WHERE app_id = {{app_id}} AND updated_at >= toDateTime({{from}}) AND updated_at < toDateTime({{to}}) GROUP BY platform ORDER BY total_jobs DESC',
  TRUE
FROM apps a
WHERE NOT EXISTS (
  SELECT 1
  FROM attribution_sql_queries q
  WHERE q.app_id = a.id AND q.query_name = 'attribution_overview'
)
ON CONFLICT (app_id, query_name, version)
DO NOTHING;
`;

async function main() {
  await db.query(ddl);

  if (config.clickhouseEnabled) {
    await ensureClickHouseSchema();
  }

  console.log('Migration completed.');
  await db.pool.end();
}

main().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await db.pool.end();
  process.exit(1);
});
