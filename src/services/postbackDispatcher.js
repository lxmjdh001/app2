const db = require('../db');
const config = require('../config');
const { sendFacebookPostback } = require('./platforms/facebook');
const { sendTikTokPostback } = require('./platforms/tiktok');
const { recordJobAnalytics } = require('./clickhouseService');

function computeRetryDelaySeconds(attemptCount) {
  const base = 30;
  const maxDelay = 1800;
  return Math.min(base * 2 ** Math.max(attemptCount - 1, 0), maxDelay);
}

async function claimJobs(batchSize) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH pick AS (
          SELECT id
          FROM postback_jobs
          WHERE status IN ('pending', 'retry')
            AND next_retry_at <= NOW()
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE postback_jobs j
       SET status = 'processing',
           updated_at = NOW()
       FROM pick
       WHERE j.id = pick.id
       RETURNING j.*`,
      [batchSize]
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getJobContext(jobId) {
  const result = await db.query(
    `SELECT
      j.id AS job_id,
      j.platform,
      j.attempt_count,
      j.platform_event_name,
      j.platform_pixel_id,
      e.id AS event_id,
      e.app_id,
      e.event_name,
      e.event_time,
      e.payload,
      pp.id AS resolved_pixel_id,
      pp.display_name AS pixel_name,
      pp.pixel_key,
      COALESCE(pp.enabled, pc.enabled) AS platform_enabled,
      COALESCE(pp.endpoint_url, pc.endpoint_url) AS endpoint_url,
      COALESCE(pp.access_token, pc.access_token) AS access_token,
      COALESCE(pp.config_json, pc.config_json) AS config_json
    FROM postback_jobs j
    JOIN events e ON e.id = j.event_id
    LEFT JOIN platform_pixels pp
      ON pp.id = j.platform_pixel_id
      AND pp.app_id = e.app_id
      AND pp.platform = j.platform
    LEFT JOIN platform_configs pc
      ON pc.app_id = e.app_id
      AND pc.platform = j.platform
    WHERE j.id = $1`,
    [jobId]
  );

  return result.rows[0];
}

async function loadJobAnalyticsRow(jobId) {
  const result = await db.query(
    `SELECT
      j.id AS job_id,
      j.event_id,
      e.app_id,
      j.platform,
      j.platform_event_name,
      j.status,
      j.attempt_count,
      COALESCE(j.response_status, 0) AS response_status,
      j.last_error,
      j.created_at,
      j.updated_at
     FROM postback_jobs j
     JOIN events e ON e.id = j.event_id
     WHERE j.id = $1`,
    [jobId]
  );

  return result.rows[0] || null;
}

async function markDone(jobId, statusCode, body) {
  await db.query(
    `UPDATE postback_jobs
     SET status = 'done',
         response_status = $2,
         response_body = LEFT($3, 4000),
         last_error = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId, statusCode, body || '']
  );

  const jobRow = await loadJobAnalyticsRow(jobId);
  if (jobRow) {
    await recordJobAnalytics(jobRow);
  }
}

async function markFailedOrRetry(jobId, attemptCount, errorText) {
  const nextAttempt = attemptCount + 1;

  if (nextAttempt >= config.maxJobAttempts) {
    await db.query(
      `UPDATE postback_jobs
       SET status = 'failed',
           attempt_count = $2,
           last_error = LEFT($3, 2000),
           updated_at = NOW()
       WHERE id = $1`,
      [jobId, nextAttempt, errorText]
    );

    const jobRow = await loadJobAnalyticsRow(jobId);
    if (jobRow) {
      await recordJobAnalytics(jobRow);
    }
    return;
  }

  const delaySeconds = computeRetryDelaySeconds(nextAttempt);
  await db.query(
    `UPDATE postback_jobs
     SET status = 'retry',
         attempt_count = $2,
         last_error = LEFT($3, 2000),
         next_retry_at = NOW() + ($4 || ' seconds')::interval,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId, nextAttempt, errorText, String(delaySeconds)]
  );

  const jobRow = await loadJobAnalyticsRow(jobId);
  if (jobRow) {
    await recordJobAnalytics(jobRow);
  }
}

async function dispatchOne(job) {
  const context = await getJobContext(job.id);
  if (!context) {
    await markFailedOrRetry(job.id, job.attempt_count, 'Job context not found');
    return;
  }

  if (context.platform_pixel_id && !context.resolved_pixel_id) {
    await markFailedOrRetry(job.id, config.maxJobAttempts - 1, 'Platform pixel not found or removed');
    return;
  }

  if (context.platform_enabled !== true) {
    await markFailedOrRetry(job.id, config.maxJobAttempts - 1, 'Platform config missing or disabled');
    return;
  }

  const event = {
    id: context.event_id,
    event_name: context.event_name,
    platform_event_name: context.platform_event_name,
    event_time: context.event_time,
    payload: context.payload
  };

  const platformConfig = {
    endpoint_url: context.endpoint_url,
    access_token: context.access_token,
    config_json: context.config_json,
    pixel_key: context.pixel_key
  };

  try {
    let result;
    if (context.platform === 'facebook') {
      result = await sendFacebookPostback({ event, platformConfig });
    } else if (context.platform === 'tiktok') {
      result = await sendTikTokPostback({ event, platformConfig });
    } else {
      throw new Error(`Unsupported platform: ${context.platform}`);
    }
    await markDone(job.id, result.status, result.body);
  } catch (error) {
    await markFailedOrRetry(job.id, job.attempt_count, error.message);
  }
}

let timer;
let running = false;

async function tick() {
  if (running) {
    return;
  }
  running = true;

  try {
    const jobs = await claimJobs(config.dispatchBatchSize);
    for (const job of jobs) {
      await dispatchOne(job);
    }
  } catch (error) {
    console.error('Dispatcher tick failed:', error.message);
  } finally {
    running = false;
  }
}

function startDispatcher() {
  timer = setInterval(() => {
    void tick();
  }, config.dispatchIntervalMs);

  void tick();
}

function stopDispatcher() {
  if (timer) {
    clearInterval(timer);
  }
}

module.exports = {
  startDispatcher,
  stopDispatcher,
  tick
};
