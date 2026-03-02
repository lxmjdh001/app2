const crypto = require('crypto');
const config = require('../config');

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeIdentifier(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, 255) : null;
}

function normalizeEventName(value) {
  return String(value || '').trim().toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomClickId() {
  return `clk_${crypto.randomBytes(12).toString('hex')}`;
}

function normalizeSourcePlatform(platform, ttclid, fbc) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'facebook' || normalized === 'tiktok') {
    return normalized;
  }
  if (ttclid) return 'tiktok';
  if (fbc) return 'facebook';
  return 'unknown';
}

function extractAttributionData(payload = {}) {
  const rawUser = payload.user_data || {};
  const rawAttribution = payload.attribution || {};

  const clickId = normalizeIdentifier(
    rawAttribution.click_id || rawUser.click_id || rawUser.ad_click_id || payload.click_id
  );
  const ttclid = normalizeIdentifier(rawAttribution.ttclid || rawUser.ttclid || payload.ttclid);
  const fbc = normalizeIdentifier(rawAttribution.fbc || rawUser.fbc || payload.fbc);
  const campaign = normalizeIdentifier(rawAttribution.campaign || payload.campaign);
  const metadata = rawAttribution.metadata || payload.metadata || {};
  const sourcePlatform = normalizeSourcePlatform(rawAttribution.platform || payload.platform, ttclid, fbc);

  return {
    clickId,
    ttclid,
    fbc,
    campaign,
    metadata,
    sourcePlatform
  };
}

function extractSdkProtocol(payload = {}) {
  const sdk = payload.sdk || {};

  return {
    eventUid: normalizeIdentifier(payload.event_uid || sdk.event_uid || payload.eventUid),
    oaUid: normalizeIdentifier(payload.oa_uid || sdk.oa_uid || payload.oaUid),
    ifa: normalizeIdentifier(payload.ifa || payload.adid || sdk.ifa),
    sdkProtocolVersion: normalizeIdentifier(payload.sdk_protocol_version || payload.protocol_version || sdk.version || 'oa-v1'),
    sessionId: normalizeIdentifier(payload.session_id || sdk.session_id),
    sdkMetadata: sdk.metadata || payload.sdk_metadata || {}
  };
}

function buildDedupeKey({ platform, eventName, eventTime, payload, sdkProtocol }) {
  const userData = payload.user_data || {};
  const customData = payload.custom_data || {};

  if (sdkProtocol?.eventUid) {
    return `evu:${platform}:${normalizeEventName(eventName)}:${sha256(sdkProtocol.eventUid)}`;
  }

  const identityKey =
    normalizeIdentifier(payload.event_id)
    || normalizeIdentifier(customData.order_id)
    || normalizeIdentifier(customData.transaction_id)
    || normalizeIdentifier(customData.deposit_id);

  if (identityKey) {
    return `id:${platform}:${normalizeEventName(eventName)}:${sha256(identityKey)}`;
  }

  const platformSignal =
    platform === 'tiktok'
      ? normalizeIdentifier(userData.ttclid || userData.click_id || userData.fbc)
      : normalizeIdentifier(userData.fbc || userData.click_id || userData.ttclid);

  if (platformSignal) {
    return `sig:${platform}:${normalizeEventName(eventName)}:${sha256(platformSignal)}`;
  }

  const userSignal = normalizeIdentifier(
    sdkProtocol?.oaUid
    || sdkProtocol?.ifa
    || userData.external_id
    || userData.email
    || userData.phone
  );

  if (userSignal) {
    const bucket = new Date(eventTime).toISOString().slice(0, 13);
    return `usr:${platform}:${normalizeEventName(eventName)}:${sha256(userSignal)}:${bucket}`;
  }

  return null;
}

async function findAttributionByIdentifiers(client, appId, attribution) {
  const result = await client.query(
    `SELECT id, app_id, source_platform, click_id, ttclid, fbc, campaign, metadata, created_at, last_seen_at
     FROM attribution_keys
     WHERE app_id = $1
       AND (
          ($2::text IS NOT NULL AND click_id = $2)
          OR ($3::text IS NOT NULL AND ttclid = $3)
          OR ($4::text IS NOT NULL AND fbc = $4)
       )
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [appId, attribution.clickId, attribution.ttclid, attribution.fbc]
  );

  return result.rows[0] || null;
}

async function updateAttribution(client, attributionId, attribution) {
  const result = await client.query(
    `UPDATE attribution_keys
     SET source_platform = CASE WHEN $2 = 'unknown' THEN source_platform ELSE $2 END,
         click_id = COALESCE(click_id, $3),
         ttclid = COALESCE(ttclid, $4),
         fbc = COALESCE(fbc, $5),
         campaign = COALESCE($6, campaign),
         metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
         last_seen_at = NOW()
     WHERE id = $1
     RETURNING id, app_id, source_platform, click_id, ttclid, fbc, campaign, metadata, created_at, last_seen_at`,
    [
      attributionId,
      attribution.sourcePlatform,
      attribution.clickId,
      attribution.ttclid,
      attribution.fbc,
      attribution.campaign,
      JSON.stringify(attribution.metadata || {})
    ]
  );

  return result.rows[0] || null;
}

async function upsertAttributionKey(client, appId, attribution) {
  if (!attribution.clickId && !attribution.ttclid && !attribution.fbc) {
    return null;
  }

  const existing = await findAttributionByIdentifiers(client, appId, attribution);
  if (existing) {
    return updateAttribution(client, existing.id, attribution);
  }

  try {
    const insertResult = await client.query(
      `INSERT INTO attribution_keys
       (app_id, source_platform, click_id, ttclid, fbc, campaign, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, app_id, source_platform, click_id, ttclid, fbc, campaign, metadata, created_at, last_seen_at`,
      [
        appId,
        attribution.sourcePlatform,
        attribution.clickId,
        attribution.ttclid,
        attribution.fbc,
        attribution.campaign,
        JSON.stringify(attribution.metadata || {})
      ]
    );
    return insertResult.rows[0] || null;
  } catch (error) {
    if (error.code !== '23505') {
      throw error;
    }

    const retried = await findAttributionByIdentifiers(client, appId, attribution);
    if (!retried) {
      throw error;
    }
    return updateAttribution(client, retried.id, attribution);
  }
}

async function loadActiveAttributionRule(client, appId) {
  const result = await client.query(
    `SELECT app_id, version, rule_name, lookback_window_hours,
            click_priority, allow_event_side_create, is_active, updated_at
     FROM attribution_rules
     WHERE app_id = $1
       AND is_active = TRUE
     ORDER BY version DESC
     LIMIT 1`,
    [appId]
  );

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  const fallback = {
    app_id: appId,
    version: 1,
    rule_name: config.defaultAttributionRuleName,
    lookback_window_hours: config.defaultAttributionLookbackHours,
    click_priority: ['click_id', 'ttclid', 'fbc'],
    allow_event_side_create: false,
    is_active: true
  };

  await client.query(
    `INSERT INTO attribution_rules
      (app_id, version, rule_name, lookback_window_hours, click_priority, allow_event_side_create, is_active)
     VALUES ($1, $2, $3, $4, $5::text[], $6, TRUE)
     ON CONFLICT (app_id, version) DO NOTHING`,
    [
      fallback.app_id,
      fallback.version,
      fallback.rule_name,
      fallback.lookback_window_hours,
      fallback.click_priority,
      fallback.allow_event_side_create
    ]
  );

  return fallback;
}

function buildPriorityCase(rule) {
  const priorities = Array.isArray(rule.click_priority) && rule.click_priority.length > 0
    ? rule.click_priority
    : ['click_id', 'ttclid', 'fbc'];

  const cases = priorities.map((item, index) => {
    if (item === 'click_id') return `WHEN click_id = $2 THEN ${index + 1}`;
    if (item === 'ttclid') return `WHEN ttclid = $3 THEN ${index + 1}`;
    if (item === 'fbc') return `WHEN fbc = $4 THEN ${index + 1}`;
    return '';
  }).filter(Boolean);

  return cases.length > 0 ? cases.join(' ') : 'WHEN click_id = $2 THEN 1 WHEN ttclid = $3 THEN 2 WHEN fbc = $4 THEN 3';
}

async function findAttributedKeyByRule(client, appId, attribution, eventTime, rule) {
  if (!attribution.clickId && !attribution.ttclid && !attribution.fbc) {
    return null;
  }

  const priorityCase = buildPriorityCase(rule);
  const lookbackHours = Number(rule.lookback_window_hours) || config.defaultAttributionLookbackHours;

  const result = await client.query(
    `SELECT id, app_id, source_platform, click_id, ttclid, fbc, campaign, metadata, created_at, last_seen_at
     FROM attribution_keys
     WHERE app_id = $1
       AND (
         ($2::text IS NOT NULL AND click_id = $2)
         OR ($3::text IS NOT NULL AND ttclid = $3)
         OR ($4::text IS NOT NULL AND fbc = $4)
       )
       AND last_seen_at >= ($5::timestamptz - ($6 || ' hours')::interval)
     ORDER BY CASE ${priorityCase} ELSE 100 END, last_seen_at DESC
     LIMIT 1`,
    [appId, attribution.clickId, attribution.ttclid, attribution.fbc, eventTime.toISOString(), String(lookbackHours)]
  );

  return result.rows[0] || null;
}

module.exports = {
  normalizeText,
  normalizeIdentifier,
  normalizeEventName,
  randomClickId,
  extractAttributionData,
  extractSdkProtocol,
  buildDedupeKey,
  upsertAttributionKey,
  loadActiveAttributionRule,
  findAttributedKeyByRule
};
