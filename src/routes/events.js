const express = require('express');
const db = require('../db');
const {
  normalizeText,
  normalizeIdentifier,
  normalizeEventName,
  extractAttributionData,
  extractSdkProtocol,
  buildDedupeKey,
  upsertAttributionKey,
  loadActiveAttributionRule,
  findAttributedKeyByRule
} = require('../services/attributionService');
const {
  isClickHouseEnabled,
  recordEventAnalytics,
  runAnalyticsSql
} = require('../services/clickhouseService');
const { hashPassword, normalizeUsername } = require('../auth');

const router = express.Router();
const allowedPlatforms = new Set(['facebook', 'tiktok']);
const allowedUserRoles = new Set(['admin', 'operator', 'analyst', 'viewer']);


const roleOrder = {
  viewer: 10,
  analyst: 20,
  operator: 30,
  admin: 40
};

function hasRolePermission(userRole, allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    return true;
  }

  const rank = roleOrder[String(userRole || '').toLowerCase()] || 0;
  return allowedRoles.some((role) => rank >= (roleOrder[String(role || '').toLowerCase()] || 0));
}

function ensureRbac(req, res, allowedRoles) {
  if (req.authType !== 'jwt') {
    return true;
  }

  if (req.user?.isSuperAdmin) {
    return true;
  }

  if (hasRolePermission(req.userRole, allowedRoles)) {
    return true;
  }

  res.status(403).json({ error: 'Insufficient role permission' });
  return false;
}

const defaultEventMappings = {
  facebook: {
    register: 'CompleteRegistration',
    signup: 'CompleteRegistration',
    ftd: 'Purchase',
    deposit: 'Purchase',
    purchase: 'Purchase',
    install_open: 'MobileAppInstall',
    install: 'MobileAppInstall',
    first_open: 'MobileAppInstall',
    '安装打开': 'MobileAppInstall'
  },
  tiktok: {
    register: 'CompleteRegistration',
    signup: 'CompleteRegistration',
    ftd: 'Purchase',
    deposit: 'Purchase',
    purchase: 'Purchase',
    install_open: 'InstallApp',
    install: 'InstallApp',
    first_open: 'InstallApp',
    '安装打开': 'InstallApp'
  }
};

function normalizeDestinations(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return ['facebook', 'tiktok'];
  }

  const filtered = input
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((platform) => allowedPlatforms.has(platform));

  return Array.from(new Set(filtered));
}

function getMappingKey(platform, internalEventName) {
  return `${platform}:${normalizeEventName(internalEventName)}`;
}

function resolveDefaultPlatformEventName(platform, eventName) {
  const normalized = normalizeEventName(eventName);
  return defaultEventMappings[platform]?.[normalized] || eventName;
}

async function loadEventMappings(client, appId, destinations) {
  const result = await client.query(
    `SELECT platform,
            LOWER(internal_event_name) AS internal_event_name,
            platform_event_name
     FROM event_name_mappings
     WHERE app_id = $1
       AND platform = ANY($2::text[])
       AND is_active = TRUE`,
    [appId, destinations]
  );

  const mapping = new Map();
  for (const row of result.rows) {
    mapping.set(getMappingKey(row.platform, row.internal_event_name), row.platform_event_name);
  }
  return mapping;
}

function resolvePlatformEventName(platform, internalEventName, mapping) {
  const mapped = mapping.get(getMappingKey(platform, internalEventName));
  if (mapped) {
    return mapped;
  }
  return resolveDefaultPlatformEventName(platform, internalEventName);
}
async function loadActivePlatformPixels(client, appId, destinations) {
  const result = await client.query(
    `SELECT id, platform, pixel_key
     FROM platform_pixels
     WHERE app_id = $1
       AND enabled = TRUE
       AND platform = ANY($2::text[])
     ORDER BY platform, priority ASC, id ASC`,
    [appId, destinations]
  );

  const mapped = new Map();
  for (const row of result.rows) {
    if (!mapped.has(row.platform)) {
      mapped.set(row.platform, []);
    }
    mapped.get(row.platform).push({ id: row.id, pixel_key: row.pixel_key });
  }

  return mapped;
}

function normalizeConfigJsonObject(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
}


async function createEventCore(req, res) {
  if (!ensureRbac(req, res, ['operator', 'admin'])) return;
  const app = req.appTenant;
  const body = req.body || {};
  const internalEventName = normalizeText(body.event_name || body.event || body.name);

  if (!internalEventName) {
    return res.status(400).json({ error: 'event_name is required' });
  }

  const eventTime = body.event_time ? new Date(body.event_time) : new Date();
  if (Number.isNaN(eventTime.getTime())) {
    return res.status(400).json({ error: 'event_time is invalid' });
  }

  const destinations = normalizeDestinations(body.destinations);
  if (destinations.length === 0) {
    return res.status(400).json({ error: 'destinations must include facebook/tiktok' });
  }

  const sdkProtocol = extractSdkProtocol(body);

  const payload = {
    event_id: normalizeIdentifier(body.event_id),
    action_source: body.action_source || 'app',
    user_data: body.user_data || {},
    custom_data: body.custom_data || {},
    raw: body.raw || null,
    sdk: {
      event_uid: sdkProtocol.eventUid,
      oa_uid: sdkProtocol.oaUid,
      ifa: sdkProtocol.ifa,
      session_id: sdkProtocol.sessionId,
      version: sdkProtocol.sdkProtocolVersion,
      metadata: sdkProtocol.sdkMetadata
    }
  };

  const attributionData = extractAttributionData(body);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rule = await loadActiveAttributionRule(client, app.id);

    let attributionRecord = await findAttributedKeyByRule(client, app.id, attributionData, eventTime, rule);
    if (!attributionRecord && rule.allow_event_side_create) {
      attributionRecord = await upsertAttributionKey(client, app.id, attributionData);
    }

    const eventResult = await client.query(
      `INSERT INTO events
        (app_id, event_name, event_time, payload, event_uid, oa_uid, ifa, sdk_protocol_version, session_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       RETURNING id, app_id, event_name, event_time, payload,
                 event_uid, oa_uid, ifa, sdk_protocol_version, session_id, created_at`,
      [
        app.id,
        internalEventName,
        eventTime.toISOString(),
        JSON.stringify(payload),
        sdkProtocol.eventUid,
        sdkProtocol.oaUid,
        sdkProtocol.ifa,
        sdkProtocol.sdkProtocolVersion,
        sdkProtocol.sessionId
      ]
    );

    const event = eventResult.rows[0];
    const mappings = await loadEventMappings(client, app.id, destinations);
    const activePixelsByPlatform = await loadActivePlatformPixels(client, app.id, destinations);

    const queuedDestinations = [];
    const dedupedDestinations = [];
    const platformEventNames = {};
    const queuedPixelTargets = {};
    let queuedJobCount = 0;

    for (const platform of destinations) {
      const platformEventName = resolvePlatformEventName(platform, internalEventName, mappings);
      platformEventNames[platform] = platformEventName;

      const dedupeKey = buildDedupeKey({
        platform,
        eventName: internalEventName,
        eventTime,
        payload,
        sdkProtocol
      });

      if (dedupeKey) {
        const dedupeInsert = await client.query(
          `INSERT INTO event_deduplications
           (app_id, platform, dedupe_key, event_id, event_name, attribution_key_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (app_id, platform, dedupe_key)
           DO NOTHING
           RETURNING id`,
          [app.id, platform, dedupeKey, event.id, internalEventName, attributionRecord?.id || null]
        );

        if (dedupeInsert.rowCount === 0) {
          dedupedDestinations.push(platform);
          continue;
        }
      }

      const pixels = activePixelsByPlatform.get(platform) || [];
      if (pixels.length === 0) {
        await client.query(
          `INSERT INTO postback_jobs
           (event_id, platform, platform_event_name, dedupe_key, attribution_key_id, attribution_rule_version, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [
            event.id,
            platform,
            platformEventName,
            dedupeKey,
            attributionRecord?.id || null,
            rule.version
          ]
        );

        queuedPixelTargets[platform] = ['legacy_default'];
        queuedDestinations.push(platform);
        queuedJobCount += 1;
        continue;
      }

      for (const pixel of pixels) {
        await client.query(
          `INSERT INTO postback_jobs
           (event_id, platform, platform_event_name, dedupe_key, attribution_key_id, attribution_rule_version, platform_pixel_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [
            event.id,
            platform,
            platformEventName,
            dedupeKey,
            attributionRecord?.id || null,
            rule.version,
            pixel.id
          ]
        );

        queuedJobCount += 1;
      }

      queuedPixelTargets[platform] = pixels.map((item) => item.pixel_key);
      queuedDestinations.push(platform);
    }

    await client.query('COMMIT');

    await recordEventAnalytics(event);

    return res.status(201).json({
      event_id: event.id,
      app_id: app.id,
      internal_event_name: internalEventName,
      sdk_protocol: {
        event_uid: sdkProtocol.eventUid,
        oa_uid: sdkProtocol.oaUid,
        ifa: sdkProtocol.ifa,
        version: sdkProtocol.sdkProtocolVersion
      },
      attribution_rule: {
        version: rule.version,
        name: rule.rule_name,
        lookback_window_hours: rule.lookback_window_hours,
        allow_event_side_create: rule.allow_event_side_create
      },
      platform_event_names: platformEventNames,
      queued_destinations: queuedDestinations,
      deduped_destinations: dedupedDestinations,
      queued_jobs: queuedJobCount,
      queued_pixel_targets: queuedPixelTargets,
      attribution_key_id: attributionRecord?.id || null,
      created_at: event.created_at
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}

router.post('/events', createEventCore);
router.post('/sdk/events', createEventCore);

router.post('/attribution/click', async (req, res) => {
  if (!ensureRbac(req, res, ['operator', 'admin'])) return;
  const app = req.appTenant;
  const attributionData = extractAttributionData(req.body || {});

  if (!attributionData.clickId && !attributionData.ttclid && !attributionData.fbc) {
    return res.status(400).json({ error: 'click_id or ttclid or fbc is required' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const attributionRecord = await upsertAttributionKey(client, app.id, attributionData);
    await client.query('COMMIT');

    return res.status(201).json({
      app_id: app.id,
      attribution_key_id: attributionRecord.id,
      source_platform: attributionData.sourcePlatform
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/jobs', async (req, res) => {
  if (!ensureRbac(req, res, ['viewer'])) return;
  const app = req.appTenant;
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
  const campaign = normalizeText(req.query.campaign);
  const platformRaw = normalizeText(req.query.platform);
  const platform = platformRaw ? platformRaw.toLowerCase() : null;

  if (platform && !allowedPlatforms.has(platform)) {
    return res.status(400).json({ error: 'platform must be facebook or tiktok' });
  }

  const whereClauses = ['e.app_id = $1'];
  const values = [app.id];

  if (campaign) {
    values.push(campaign);
    whereClauses.push(`ak.campaign = $${values.length}`);
  }

  if (platform) {
    values.push(platform);
    whereClauses.push(`j.platform = $${values.length}`);
  }

  values.push(limit);

  const result = await db.query(
    `SELECT j.id, j.event_id, j.platform, j.platform_event_name, j.status, j.attempt_count,
            j.response_status, j.last_error, j.dedupe_key, j.attribution_key_id,
            j.attribution_rule_version, j.platform_pixel_id,
            pp.display_name AS pixel_name, pp.pixel_key,
            ak.campaign AS attribution_campaign, ak.source_platform AS attribution_source_platform,
            ak.click_id AS attribution_click_id, ak.ttclid AS attribution_ttclid, ak.fbc AS attribution_fbc,
            j.next_retry_at, j.updated_at
     FROM postback_jobs j
     JOIN events e ON e.id = j.event_id
     LEFT JOIN platform_pixels pp ON pp.id = j.platform_pixel_id
     LEFT JOIN attribution_keys ak ON ak.id = j.attribution_key_id
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY j.id DESC
     LIMIT $${values.length}`,
    values
  );

  return res.json({ jobs: result.rows });
});

router.get('/event-mappings', async (req, res) => {
  if (!ensureRbac(req, res, ['viewer'])) return;
  const app = req.appTenant;
  const result = await db.query(
    `SELECT platform, internal_event_name, platform_event_name, is_active, updated_at
     FROM event_name_mappings
     WHERE app_id = $1
     ORDER BY platform, internal_event_name`,
    [app.id]
  );

  return res.json({ mappings: result.rows });
});

router.put('/event-mappings/:platform', async (req, res) => {
  if (!ensureRbac(req, res, ['operator', 'admin'])) return;
  const app = req.appTenant;
  const platform = String(req.params.platform || '').trim().toLowerCase();
  if (!allowedPlatforms.has(platform)) {
    return res.status(400).json({ error: 'platform must be facebook or tiktok' });
  }

  const internalEventName = normalizeEventName(req.body.internal_event_name);
  const platformEventName = normalizeText(req.body.platform_event_name);
  const isActive = req.body.is_active !== undefined ? Boolean(req.body.is_active) : true;

  if (!internalEventName || !platformEventName) {
    return res.status(400).json({ error: 'internal_event_name and platform_event_name are required' });
  }

  const result = await db.query(
    `INSERT INTO event_name_mappings
      (app_id, platform, internal_event_name, platform_event_name, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (app_id, platform, internal_event_name)
     DO UPDATE SET
       platform_event_name = EXCLUDED.platform_event_name,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
     RETURNING app_id, platform, internal_event_name, platform_event_name, is_active, updated_at`,
    [app.id, platform, internalEventName, platformEventName, isActive]
  );

  return res.json({ mapping: result.rows[0] });
});

router.get('/attribution-rules', async (req, res) => {
  if (!ensureRbac(req, res, ['viewer'])) return;
  const app = req.appTenant;
  const result = await db.query(
    `SELECT version, rule_name, lookback_window_hours,
            click_priority, allow_event_side_create,
            is_active, created_at, updated_at
     FROM attribution_rules
     WHERE app_id = $1
     ORDER BY version DESC`,
    [app.id]
  );

  return res.json({ rules: result.rows });
});

router.post('/attribution-rules', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const body = req.body || {};

  const ruleName = normalizeText(body.rule_name) || 'last_touch_custom';
  const lookbackWindowHours = Number.parseInt(body.lookback_window_hours, 10);
  const clickPriority = Array.isArray(body.click_priority) && body.click_priority.length > 0
    ? body.click_priority.map((item) => String(item).toLowerCase())
    : ['click_id', 'ttclid', 'fbc'];
  const allowEventSideCreate = Boolean(body.allow_event_side_create);
  const activate = body.activate !== undefined ? Boolean(body.activate) : true;

  if (!Number.isFinite(lookbackWindowHours) || lookbackWindowHours <= 0) {
    return res.status(400).json({ error: 'lookback_window_hours must be positive integer' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const maxVersionResult = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version
       FROM attribution_rules
       WHERE app_id = $1`,
      [app.id]
    );

    const version = Number(maxVersionResult.rows[0].max_version) + 1;

    if (activate) {
      await client.query(
        `UPDATE attribution_rules
         SET is_active = FALSE, updated_at = NOW()
         WHERE app_id = $1`,
        [app.id]
      );
    }

    const inserted = await client.query(
      `INSERT INTO attribution_rules
        (app_id, version, rule_name, lookback_window_hours,
         click_priority, allow_event_side_create, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, NOW())
       RETURNING version, rule_name, lookback_window_hours,
                 click_priority, allow_event_side_create,
                 is_active, created_at, updated_at`,
      [
        app.id,
        version,
        ruleName,
        lookbackWindowHours,
        clickPriority,
        allowEventSideCreate,
        activate
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ rule: inserted.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/attribution-rules/:version/activate', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const version = Number.parseInt(req.params.version, 10);

  if (!Number.isFinite(version) || version <= 0) {
    return res.status(400).json({ error: 'version must be positive integer' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const exists = await client.query(
      `SELECT 1
       FROM attribution_rules
       WHERE app_id = $1
         AND version = $2
       LIMIT 1`,
      [app.id, version]
    );

    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'rule version not found' });
    }

    await client.query(
      `UPDATE attribution_rules
       SET is_active = FALSE, updated_at = NOW()
       WHERE app_id = $1`,
      [app.id]
    );

    const result = await client.query(
      `UPDATE attribution_rules
       SET is_active = TRUE, updated_at = NOW()
       WHERE app_id = $1
         AND version = $2
       RETURNING version, rule_name, lookback_window_hours,
                 click_priority, allow_event_side_create,
                 is_active, updated_at`,
      [app.id, version]
    );

    await client.query('COMMIT');
    return res.json({ rule: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/analytics/sql-queries', async (req, res) => {
  if (!ensureRbac(req, res, ['analyst', 'operator', 'admin'])) return;
  const app = req.appTenant;
  const result = await db.query(
    `SELECT query_name, version, sql_template, is_active, updated_at
     FROM attribution_sql_queries
     WHERE app_id = $1
     ORDER BY query_name, version DESC`,
    [app.id]
  );

  return res.json({
    clickhouse_enabled: isClickHouseEnabled(),
    queries: result.rows
  });
});

router.put('/analytics/sql-queries/:queryName', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const queryName = normalizeEventName(req.params.queryName);
  const sqlTemplate = normalizeText(req.body.sql_template);
  const activate = req.body.activate !== undefined ? Boolean(req.body.activate) : true;

  if (!queryName || !sqlTemplate) {
    return res.status(400).json({ error: 'queryName and sql_template are required' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const maxVersionResult = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version
       FROM attribution_sql_queries
       WHERE app_id = $1
         AND query_name = $2`,
      [app.id, queryName]
    );

    const version = Number(maxVersionResult.rows[0].max_version) + 1;

    if (activate) {
      await client.query(
        `UPDATE attribution_sql_queries
         SET is_active = FALSE,
             updated_at = NOW()
         WHERE app_id = $1
           AND query_name = $2`,
        [app.id, queryName]
      );
    }

    const inserted = await client.query(
      `INSERT INTO attribution_sql_queries
        (app_id, query_name, version, sql_template, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING query_name, version, sql_template, is_active, updated_at`,
      [app.id, queryName, version, sqlTemplate, activate]
    );

    await client.query('COMMIT');
    return res.status(201).json({ query: inserted.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/analytics/run/:queryName', async (req, res) => {
  if (!ensureRbac(req, res, ['analyst', 'operator', 'admin'])) return;
  const app = req.appTenant;
  const queryName = normalizeEventName(req.params.queryName);

  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return res.status(400).json({ error: 'from/to invalid' });
  }

  const sqlRow = await db.query(
    `SELECT sql_template, version
     FROM attribution_sql_queries
     WHERE app_id = $1
       AND query_name = $2
       AND is_active = TRUE
     ORDER BY version DESC
     LIMIT 1`,
    [app.id, queryName]
  );

  if (sqlRow.rowCount === 0) {
    return res.status(404).json({ error: 'active sql query not found' });
  }

  if (!isClickHouseEnabled()) {
    const fallback = await db.query(
      `SELECT platform,
              COUNT(*)::bigint AS total_jobs,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::bigint AS done_jobs
       FROM postback_jobs
       WHERE created_at >= $1
         AND created_at < $2
         AND event_id IN (
           SELECT id
           FROM events
           WHERE app_id = $3
         )
       GROUP BY platform
       ORDER BY total_jobs DESC`,
      [from.toISOString(), to.toISOString(), app.id]
    );

    return res.json({
      source: 'postgres_fallback',
      query_name: queryName,
      version: sqlRow.rows[0].version,
      rows: fallback.rows
    });
  }

  try {
    const rows = await runAnalyticsSql(sqlRow.rows[0].sql_template, {
      appId: app.id,
      from: from.toISOString().slice(0, 19).replace('T', ' '),
      to: to.toISOString().slice(0, 19).replace('T', ' ')
    });

    return res.json({
      source: 'clickhouse',
      query_name: queryName,
      version: sqlRow.rows[0].version,
      rows
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


router.get('/platform-configs', async (req, res) => {
  if (!ensureRbac(req, res, ['viewer'])) return;
  const app = req.appTenant;
  const result = await db.query(
    `SELECT platform, enabled, endpoint_url, config_json, updated_at
     FROM platform_configs
     WHERE app_id = $1
     ORDER BY platform`,
    [app.id]
  );

  return res.json({ platform_configs: result.rows });
});

router.get('/platform-pixels', async (req, res) => {
  if (!ensureRbac(req, res, ['viewer'])) return;
  const app = req.appTenant;

  const result = await db.query(
    `SELECT id, app_id, platform, display_name, pixel_key, enabled, endpoint_url,
            config_json, priority, updated_at,
            (access_token IS NOT NULL AND access_token <> '') AS has_access_token
     FROM platform_pixels
     WHERE app_id = $1
     ORDER BY platform, priority ASC, id ASC`,
    [app.id]
  );

  return res.json({ platform_pixels: result.rows });
});

router.post('/platform-pixels/:platform', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const platform = String(req.params.platform || '').trim().toLowerCase();

  if (!allowedPlatforms.has(platform)) {
    return res.status(400).json({ error: 'platform must be facebook or tiktok' });
  }

  const pixelKey = normalizeText(req.body?.pixel_key);
  const displayName = normalizeText(req.body?.display_name) || pixelKey;
  const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true;
  const endpointUrl = normalizeText(req.body?.endpoint_url) || null;
  const accessToken = normalizeText(req.body?.access_token) || null;
  const priority = Number.parseInt(String(req.body?.priority ?? '100'), 10);
  const configJson = normalizeConfigJsonObject(req.body?.config_json);

  if (!pixelKey) {
    return res.status(400).json({ error: 'pixel_key is required' });
  }

  if (!Number.isFinite(priority) || priority < 0) {
    return res.status(400).json({ error: 'priority must be >= 0' });
  }

  if (!configJson) {
    return res.status(400).json({ error: 'config_json must be object json' });
  }

  const result = await db.query(
    `INSERT INTO platform_pixels
      (app_id, platform, display_name, pixel_key, enabled, endpoint_url, access_token, config_json, priority, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW())
     ON CONFLICT (app_id, platform, pixel_key)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       enabled = EXCLUDED.enabled,
       endpoint_url = EXCLUDED.endpoint_url,
       access_token = COALESCE(EXCLUDED.access_token, platform_pixels.access_token),
       config_json = EXCLUDED.config_json,
       priority = EXCLUDED.priority,
       updated_at = NOW()
     RETURNING id, app_id, platform, display_name, pixel_key, enabled,
               endpoint_url, config_json, priority, updated_at`,
    [app.id, platform, displayName, pixelKey, enabled, endpointUrl, accessToken, JSON.stringify(configJson), priority]
  );

  return res.status(201).json({ platform_pixel: result.rows[0] });
});

router.patch('/platform-pixels/:pixelId', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const pixelId = Number.parseInt(String(req.params.pixelId || ''), 10);

  if (!Number.isFinite(pixelId) || pixelId <= 0) {
    return res.status(400).json({ error: 'invalid pixel id' });
  }

  const currentResult = await db.query(
    `SELECT id, platform, display_name, pixel_key, enabled, endpoint_url, access_token, config_json, priority
     FROM platform_pixels
     WHERE id = $1
       AND app_id = $2
     LIMIT 1`,
    [pixelId, app.id]
  );

  if (currentResult.rowCount === 0) {
    return res.status(404).json({ error: 'platform pixel not found' });
  }

  const current = currentResult.rows[0];
  const nextDisplayName = req.body?.display_name !== undefined
    ? (normalizeText(req.body.display_name) || current.display_name)
    : current.display_name;
  const nextPixelKey = req.body?.pixel_key !== undefined
    ? normalizeText(req.body.pixel_key)
    : current.pixel_key;
  const nextEnabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : current.enabled;
  const nextEndpointUrl = req.body?.endpoint_url !== undefined
    ? (normalizeText(req.body.endpoint_url) || null)
    : current.endpoint_url;
  const nextAccessToken = req.body?.access_token !== undefined
    ? (normalizeText(req.body.access_token) || null)
    : current.access_token;

  const nextPriority = req.body?.priority !== undefined
    ? Number.parseInt(String(req.body.priority), 10)
    : current.priority;

  if (!nextPixelKey) {
    return res.status(400).json({ error: 'pixel_key is required' });
  }

  if (!Number.isFinite(nextPriority) || nextPriority < 0) {
    return res.status(400).json({ error: 'priority must be >= 0' });
  }

  let nextConfigJson = current.config_json;
  if (req.body?.config_json !== undefined) {
    const parsed = normalizeConfigJsonObject(req.body.config_json);
    if (!parsed) {
      return res.status(400).json({ error: 'config_json must be object json' });
    }
    nextConfigJson = parsed;
  }

  const updated = await db.query(
    `UPDATE platform_pixels
     SET display_name = $3,
         pixel_key = $4,
         enabled = $5,
         endpoint_url = $6,
         access_token = $7,
         config_json = $8::jsonb,
         priority = $9,
         updated_at = NOW()
     WHERE id = $1
       AND app_id = $2
     RETURNING id, app_id, platform, display_name, pixel_key, enabled,
               endpoint_url, config_json, priority, updated_at`,
    [
      pixelId,
      app.id,
      nextDisplayName,
      nextPixelKey,
      nextEnabled,
      nextEndpointUrl,
      nextAccessToken,
      JSON.stringify(nextConfigJson),
      nextPriority
    ]
  );

  return res.json({ platform_pixel: updated.rows[0] });
});

router.delete('/platform-pixels/:pixelId', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const pixelId = Number.parseInt(String(req.params.pixelId || ''), 10);

  if (!Number.isFinite(pixelId) || pixelId <= 0) {
    return res.status(400).json({ error: 'invalid pixel id' });
  }

  const result = await db.query(
    `DELETE FROM platform_pixels
     WHERE id = $1
       AND app_id = $2
     RETURNING id, platform, pixel_key`,
    [pixelId, app.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'platform pixel not found' });
  }

  return res.json({ deleted: result.rows[0] });
});

router.get('/click-events', async (req, res) => {
  if (!ensureRbac(req, res, ['viewer'])) return;
  const app = req.appTenant;
  const limit = Math.min(Number.parseInt(String(req.query.limit || '50'), 10) || 50, 500);

  const result = await db.query(
    `SELECT id, click_id, ttclid, fbc, source_platform, campaign, redirect_url,
            request_ip, created_at
     FROM click_events
     WHERE app_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [app.id, limit]
  );

  return res.json({ click_events: result.rows });
});

router.get('/users', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;

  const app = req.appTenant;
  const result = await db.query(
    `SELECT u.id, u.username, u.display_name, u.is_active, u.is_super_admin,
            r.role, r.updated_at
     FROM app_user_roles r
     JOIN users u ON u.id = r.user_id
     WHERE r.app_id = $1
     ORDER BY u.id`,
    [app.id]
  );

  return res.json({ users: result.rows });
});

router.post('/users', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;

  const app = req.appTenant;
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const displayNameRaw = normalizeText(req.body?.display_name);
  const role = String(req.body?.role || 'viewer').toLowerCase();

  if (!username || password.length < 6) {
    return res.status(400).json({ error: 'username and password(min 6) are required' });
  }

  if (!allowedUserRoles.has(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  const passwordHash = await hashPassword(password);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, display_name, is_active, is_super_admin)
       VALUES ($1, $2, $3, TRUE, FALSE)
       ON CONFLICT (username)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         is_active = TRUE,
         updated_at = NOW()
       RETURNING id, username, display_name, is_active, is_super_admin`,
      [username, passwordHash, displayNameRaw]
    );

    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO app_user_roles (app_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (app_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [app.id, user.id, role]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        is_active: user.is_active,
        is_super_admin: user.is_super_admin,
        role
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.patch('/users/:userId/role', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;

  const app = req.appTenant;
  const userId = Number.parseInt(String(req.params.userId || ''), 10);
  const role = String(req.body?.role || '').toLowerCase();

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  if (!allowedUserRoles.has(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  const result = await db.query(
    `UPDATE app_user_roles
     SET role = $3,
         updated_at = NOW()
     WHERE app_id = $1
       AND user_id = $2
     RETURNING app_id, user_id, role, updated_at`,
    [app.id, userId, role]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'user role not found in app' });
  }

  return res.json({ user_role: result.rows[0] });
});

router.patch('/users/:userId/status', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;

  const app = req.appTenant;
  const userId = Number.parseInt(String(req.params.userId || ''), 10);
  const isActive = Boolean(req.body?.is_active);

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  const membership = await db.query(
    `SELECT u.id, u.username, u.is_super_admin, u.is_active
     FROM app_user_roles r
     JOIN users u ON u.id = r.user_id
     WHERE r.app_id = $1
       AND u.id = $2
     LIMIT 1`,
    [app.id, userId]
  );

  if (membership.rowCount === 0) {
    return res.status(404).json({ error: 'user not found in app' });
  }

  const target = membership.rows[0];

  if (target.is_super_admin && !isActive) {
    return res.status(400).json({ error: 'cannot disable super admin user' });
  }

  if (req.user?.id && String(req.user.id) === String(userId) && !isActive) {
    return res.status(400).json({ error: 'cannot disable current login user' });
  }

  const updateResult = await db.query(
    `UPDATE users
     SET is_active = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, username, is_active, is_super_admin, updated_at`,
    [userId, isActive]
  );

  return res.json({ user: updateResult.rows[0] });
});

router.patch('/platform-configs/:platform', async (req, res) => {
  if (!ensureRbac(req, res, ['admin'])) return;
  const app = req.appTenant;
  const platform = String(req.params.platform || '').trim().toLowerCase();
  if (!allowedPlatforms.has(platform)) {
    return res.status(400).json({ error: 'platform must be facebook or tiktok' });
  }

  const enabled = req.body.enabled !== undefined ? Boolean(req.body.enabled) : true;
  const endpointUrl = req.body.endpoint_url || null;
  const accessToken = req.body.access_token || null;
  const configJson = normalizeConfigJsonObject(req.body.config_json);
  if (!configJson) {
    return res.status(400).json({ error: "config_json must be object json" });
  }

  const result = await db.query(
    `INSERT INTO platform_configs (app_id, platform, enabled, endpoint_url, access_token, config_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT (app_id, platform)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       endpoint_url = EXCLUDED.endpoint_url,
       access_token = EXCLUDED.access_token,
       config_json = EXCLUDED.config_json,
       updated_at = NOW()
     RETURNING app_id, platform, enabled, endpoint_url, config_json, updated_at`,
    [app.id, platform, enabled, endpointUrl, accessToken, JSON.stringify(configJson)]
  );

  return res.json({ platform_config: result.rows[0] });
});

module.exports = router;
