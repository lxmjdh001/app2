const { createClient } = require('@clickhouse/client');
const config = require('../config');

let client;

function isClickHouseEnabled() {
  return Boolean(config.clickhouseEnabled);
}

function getClient() {
  if (!isClickHouseEnabled()) {
    return null;
  }

  if (!client) {
    client = createClient({
      url: config.clickhouseUrl,
      database: config.clickhouseDatabase,
      username: config.clickhouseUsername,
      password: config.clickhousePassword,
      request_timeout: config.clickhouseRequestTimeoutMs
    });
  }

  return client;
}

async function ensureClickHouseSchema() {
  if (!isClickHouseEnabled()) {
    return;
  }

  const ch = getClient();

  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.clickhouseDatabase}` });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${config.clickhouseDatabase}.events_analytics (
        event_id String,
        app_id UInt64,
        event_name String,
        event_time DateTime,
        created_at DateTime,
        event_uid String,
        oa_uid String,
        ifa String,
        click_id String,
        ttclid String,
        fbc String,
        revenue Float64,
        currency String,
        payload_json String
      )
      ENGINE = MergeTree
      ORDER BY (app_id, event_time, event_id)
    `
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${config.clickhouseDatabase}.postback_jobs_analytics (
        job_id UInt64,
        event_id String,
        app_id UInt64,
        platform String,
        platform_event_name String,
        status String,
        attempt_count UInt32,
        response_status Int32,
        last_error String,
        created_at DateTime,
        updated_at DateTime
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (app_id, platform, updated_at, job_id)
    `
  });
}

function toDateTimeString(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function recordEventAnalytics(eventRow) {
  if (!isClickHouseEnabled()) return;

  try {
    const payload = eventRow.payload || {};
    const userData = payload.user_data || {};
    const customData = payload.custom_data || {};

    const ch = getClient();
    await ch.insert({
      table: `${config.clickhouseDatabase}.events_analytics`,
      values: [{
        event_id: String(eventRow.id),
        app_id: Number(eventRow.app_id),
        event_name: eventRow.event_name || '',
        event_time: toDateTimeString(eventRow.event_time),
        created_at: toDateTimeString(eventRow.created_at),
        event_uid: eventRow.event_uid || '',
        oa_uid: eventRow.oa_uid || '',
        ifa: eventRow.ifa || '',
        click_id: userData.click_id || '',
        ttclid: userData.ttclid || '',
        fbc: userData.fbc || '',
        revenue: Number(customData.value || customData.revenue || 0),
        currency: String(customData.currency || 'USD'),
        payload_json: JSON.stringify(payload)
      }],
      format: 'JSONEachRow'
    });
  } catch (error) {
    console.error('recordEventAnalytics failed:', error.message);
  }
}

async function recordJobAnalytics(jobRow) {
  if (!isClickHouseEnabled()) return;

  try {
    const ch = getClient();
    await ch.insert({
      table: `${config.clickhouseDatabase}.postback_jobs_analytics`,
      values: [{
        job_id: Number(jobRow.job_id),
        event_id: String(jobRow.event_id),
        app_id: Number(jobRow.app_id),
        platform: String(jobRow.platform || ''),
        platform_event_name: String(jobRow.platform_event_name || ''),
        status: String(jobRow.status || ''),
        attempt_count: Number(jobRow.attempt_count || 0),
        response_status: Number(jobRow.response_status || 0),
        last_error: String(jobRow.last_error || ''),
        created_at: toDateTimeString(jobRow.created_at),
        updated_at: toDateTimeString(jobRow.updated_at)
      }],
      format: 'JSONEachRow'
    });
  } catch (error) {
    console.error('recordJobAnalytics failed:', error.message);
  }
}

function renderSqlTemplate(sqlTemplate, params) {
  let sql = sqlTemplate;
  sql = sql.replace(/\{\{\s*app_id\s*\}\}/g, String(params.appId));
  sql = sql.replace(/\{\{\s*from\s*\}\}/g, `'${params.from}'`);
  sql = sql.replace(/\{\{\s*to\s*\}\}/g, `'${params.to}'`);
  return sql;
}

function isSafeSelectSql(sql) {
  const trimmed = String(sql || '').trim();
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    return false;
  }
  const withoutTrailing = trimmed.replace(/;\s*$/, '');
  return !withoutTrailing.includes(';');
}

async function runAnalyticsSql(sqlTemplate, params) {
  if (!isClickHouseEnabled()) {
    throw new Error('ClickHouse is not enabled');
  }

  const sql = renderSqlTemplate(sqlTemplate, params);
  if (!isSafeSelectSql(sql)) {
    throw new Error('Only single SELECT/WITH query is allowed');
  }

  const ch = getClient();
  const result = await ch.query({ query: sql, format: 'JSONEachRow' });
  return result.json();
}

module.exports = {
  isClickHouseEnabled,
  ensureClickHouseSchema,
  recordEventAnalytics,
  recordJobAnalytics,
  runAnalyticsSql
};
