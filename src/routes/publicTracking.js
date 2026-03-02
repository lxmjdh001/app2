const express = require('express');
const db = require('../db');
const {
  randomClickId,
  normalizeIdentifier,
  normalizeText,
  extractAttributionData,
  upsertAttributionKey
} = require('../services/attributionService');

const router = express.Router();

function isValidRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function buildRedirectUrl(rawUrl, clickId, appendClickId) {
  if (!rawUrl) return rawUrl;

  if (rawUrl.includes('{{click_id}}')) {
    return rawUrl.replaceAll('{{click_id}}', encodeURIComponent(clickId));
  }

  if (appendClickId) {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has('click_id')) {
      parsed.searchParams.set('click_id', clickId);
    }
    return parsed.toString();
  }

  return rawUrl;
}

async function resolveAppByApiKey(client, apiKey) {
  const result = await client.query(
    `SELECT id, name, api_key
     FROM apps
     WHERE api_key = $1
       AND is_active = TRUE
     LIMIT 1`,
    [apiKey]
  );

  return result.rows[0] || null;
}

function parseMetadata(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  try {
    return JSON.parse(String(input));
  } catch (_error) {
    return { raw: String(input) };
  }
}

async function persistClick({ client, app, attribution, redirectUrl, rawPayload, req }) {
  const clickId = attribution.clickId || randomClickId();
  const normalizedAttribution = {
    ...attribution,
    clickId
  };

  const attributionRecord = await upsertAttributionKey(client, app.id, normalizedAttribution);

  await client.query(
    `INSERT INTO click_events
      (app_id, click_id, ttclid, fbc, source_platform, campaign, redirect_url,
       request_ip, user_agent, query_json)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      app.id,
      clickId,
      normalizeIdentifier(normalizedAttribution.ttclid),
      normalizeIdentifier(normalizedAttribution.fbc),
      normalizedAttribution.sourcePlatform,
      normalizeText(normalizedAttribution.campaign),
      redirectUrl,
      req.ip,
      req.headers['user-agent'] || null,
      JSON.stringify(rawPayload || {})
    ]
  );

  return {
    clickId,
    attributionKeyId: attributionRecord?.id || null,
    sourcePlatform: normalizedAttribution.sourcePlatform
  };
}

router.get('/track/click', async (req, res) => {
  const appKey = normalizeText(req.query.app_key);
  const redirectRaw = normalizeText(req.query.redirect);

  if (!appKey) {
    return res.status(400).json({ error: 'app_key is required' });
  }

  if (!redirectRaw || !isValidRedirectUrl(redirectRaw)) {
    return res.status(400).json({ error: 'redirect must be a valid http/https URL' });
  }

  const payload = {
    platform: req.query.platform,
    click_id: req.query.click_id,
    ttclid: req.query.ttclid,
    fbc: req.query.fbc,
    campaign: req.query.campaign,
    metadata: parseMetadata(req.query.metadata),
    user_data: {
      click_id: req.query.click_id,
      ttclid: req.query.ttclid,
      fbc: req.query.fbc
    }
  };

  const appendClickId = String(req.query.append_click_id || 'false').toLowerCase() === 'true';

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const app = await resolveAppByApiKey(client, appKey);
    if (!app) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'app not found' });
    }

    const attribution = extractAttributionData(payload);
    const tracked = await persistClick({
      client,
      app,
      attribution,
      redirectUrl: redirectRaw,
      rawPayload: req.query,
      req
    });

    await client.query('COMMIT');

    const redirectUrl = buildRedirectUrl(redirectRaw, tracked.clickId, appendClickId);

    if (String(req.query.format || '').toLowerCase() === 'json') {
      return res.status(200).json({
        app_id: app.id,
        click_id: tracked.clickId,
        attribution_key_id: tracked.attributionKeyId,
        source_platform: tracked.sourcePlatform,
        redirect_url: redirectUrl
      });
    }

    return res.redirect(302, redirectUrl);
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/track/click', async (req, res) => {
  const body = req.body || {};
  const appKey = normalizeText(body.app_key);
  const redirectRaw = normalizeText(body.redirect || body.redirect_url || 'https://example.com');

  if (!appKey) {
    return res.status(400).json({ error: 'app_key is required' });
  }

  if (!isValidRedirectUrl(redirectRaw)) {
    return res.status(400).json({ error: 'redirect must be a valid http/https URL' });
  }

  const payload = {
    ...body,
    user_data: body.user_data || {
      click_id: body.click_id,
      ttclid: body.ttclid,
      fbc: body.fbc
    }
  };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const app = await resolveAppByApiKey(client, appKey);
    if (!app) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'app not found' });
    }

    const attribution = extractAttributionData(payload);
    const tracked = await persistClick({
      client,
      app,
      attribution,
      redirectUrl: redirectRaw,
      rawPayload: body,
      req
    });

    await client.query('COMMIT');

    return res.status(201).json({
      app_id: app.id,
      click_id: tracked.clickId,
      attribution_key_id: tracked.attributionKeyId,
      source_platform: tracked.sourcePlatform,
      redirect_url: redirectRaw
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
