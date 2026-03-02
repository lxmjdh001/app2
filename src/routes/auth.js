const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const config = require('../config');
const {
  comparePassword,
  hashPassword,
  listUserAppRoles,
  normalizeUsername,
  requireJwt,
  signToken,
  hasMinimumRole
} = require('../auth');

const router = express.Router();

function normalizeDisplayName(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeAppName(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function validPassword(value) {
  return String(value || '').length >= 6;
}

function newApiKey() {
  return `app_${crypto.randomBytes(18).toString('hex')}`;
}

async function insertAppWithRetry(client, appName) {
  for (let i = 0; i < 5; i += 1) {
    const apiKey = newApiKey();
    try {
      const result = await client.query(
        `INSERT INTO apps (name, api_key)
         VALUES ($1, $2)
         RETURNING id, name, api_key, is_active, created_at`,
        [appName, apiKey]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate unique api_key after retries');
}

async function bootstrapAppDefaults(client, appId) {
  await client.query(
    `INSERT INTO platform_configs (app_id, platform, enabled, config_json)
     VALUES
      ($1, 'facebook', FALSE, '{}'::jsonb),
      ($1, 'tiktok', FALSE, '{}'::jsonb)
     ON CONFLICT (app_id, platform) DO NOTHING`,
    [appId]
  );

  await client.query(
    `INSERT INTO event_name_mappings (app_id, platform, internal_event_name, platform_event_name, is_active)
     VALUES
      ($1, 'facebook', 'register', 'CompleteRegistration', TRUE),
      ($1, 'facebook', 'signup', 'CompleteRegistration', TRUE),
      ($1, 'facebook', 'ftd', 'Purchase', TRUE),
      ($1, 'facebook', 'deposit', 'Purchase', TRUE),
      ($1, 'facebook', 'install_open', 'MobileAppInstall', TRUE),
      ($1, 'facebook', 'install', 'MobileAppInstall', TRUE),
      ($1, 'facebook', 'first_open', 'MobileAppInstall', TRUE),
      ($1, 'tiktok', 'register', 'CompleteRegistration', TRUE),
      ($1, 'tiktok', 'signup', 'CompleteRegistration', TRUE),
      ($1, 'tiktok', 'ftd', 'Purchase', TRUE),
      ($1, 'tiktok', 'deposit', 'Purchase', TRUE),
      ($1, 'tiktok', 'install_open', 'InstallApp', TRUE),
      ($1, 'tiktok', 'install', 'InstallApp', TRUE),
      ($1, 'tiktok', 'first_open', 'InstallApp', TRUE)
     ON CONFLICT (app_id, platform, internal_event_name)
     DO UPDATE SET
       platform_event_name = EXCLUDED.platform_event_name,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    [appId]
  );

  await client.query(
    `INSERT INTO attribution_rules
      (app_id, version, rule_name, lookback_window_hours, click_priority, allow_event_side_create, is_active)
     VALUES ($1, 1, $2, $3, ARRAY['click_id','ttclid','fbc'], FALSE, TRUE)
     ON CONFLICT (app_id, version)
     DO UPDATE SET
       rule_name = EXCLUDED.rule_name,
       lookback_window_hours = EXCLUDED.lookback_window_hours,
       click_priority = EXCLUDED.click_priority,
       allow_event_side_create = EXCLUDED.allow_event_side_create,
       is_active = TRUE,
       updated_at = NOW()`,
    [appId, config.defaultAttributionRuleName, config.defaultAttributionLookbackHours]
  );

  await client.query(
    `INSERT INTO attribution_sql_queries
      (app_id, query_name, version, sql_template, is_active)
     VALUES
      ($1, 'attribution_overview', 1,
       'SELECT platform, count() AS total_jobs, countIf(status = ''done'') AS done_jobs, round(done_jobs / nullIf(total_jobs, 0), 4) AS done_rate FROM postback_jobs_analytics WHERE app_id = {{app_id}} AND updated_at >= toDateTime({{from}}) AND updated_at < toDateTime({{to}}) GROUP BY platform ORDER BY total_jobs DESC',
       TRUE)
     ON CONFLICT (app_id, query_name, version) DO NOTHING`,
    [appId]
  );
}

router.post('/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const userResult = await db.query(
    `SELECT id, username, password_hash, display_name, is_active, is_super_admin
     FROM users
     WHERE username = $1
     LIMIT 1`,
    [username]
  );

  if (userResult.rowCount === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = userResult.rows[0];
  if (user.is_active !== true) {
    return res.status(403).json({ error: 'User disabled' });
  }

  const matched = await comparePassword(password, user.password_hash);
  if (!matched) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const appRoles = await listUserAppRoles(user.id);

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      is_super_admin: user.is_super_admin
    },
    app_roles: appRoles
  });
});

router.get('/auth/me', requireJwt, async (req, res) => {
  const appRoles = await listUserAppRoles(req.user.id);

  return res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      display_name: req.user.displayName,
      is_super_admin: req.user.isSuperAdmin
    },
    app_roles: appRoles
  });
});

router.get('/auth/apps', requireJwt, async (req, res) => {
  if (req.user.isSuperAdmin) {
    const result = await db.query(
      `SELECT a.id, a.name, a.api_key, a.is_active, a.created_at,
              COALESCE(r.role, 'admin') AS role
       FROM apps a
       LEFT JOIN app_user_roles r
         ON r.app_id = a.id
        AND r.user_id = $1
       WHERE a.is_active = TRUE
       ORDER BY a.id`,
      [req.user.id]
    );

    return res.json({ apps: result.rows });
  }

  const result = await db.query(
    `SELECT a.id, a.name, a.api_key, a.is_active, a.created_at, r.role
     FROM app_user_roles r
     JOIN apps a ON a.id = r.app_id
     WHERE r.user_id = $1
       AND a.is_active = TRUE
     ORDER BY a.id`,
    [req.user.id]
  );

  return res.json({ apps: result.rows });
});

router.post('/auth/apps', requireJwt, async (req, res) => {
  const appName = normalizeAppName(req.body?.name);

  if (!appName) {
    return res.status(400).json({ error: 'app name is required' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const app = await insertAppWithRetry(client, appName);

    await client.query(
      `INSERT INTO app_user_roles (app_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (app_id, user_id)
       DO UPDATE SET
         role = 'admin',
         updated_at = NOW()`,
      [app.id, req.user.id]
    );

    await bootstrapAppDefaults(client, app.id);

    await client.query('COMMIT');

    const appRoles = await listUserAppRoles(req.user.id);

    return res.status(201).json({
      app: {
        ...app,
        role: 'admin'
      },
      app_roles: appRoles
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/auth/users', requireJwt, async (req, res) => {
  const appId = Number.parseInt(String(req.body?.app_id || ''), 10);
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const displayName = normalizeDisplayName(req.body?.display_name);
  const role = String(req.body?.role || 'viewer').toLowerCase();

  if (!Number.isFinite(appId) || appId <= 0) {
    return res.status(400).json({ error: 'app_id is required' });
  }

  if (!username || !validPassword(password)) {
    return res.status(400).json({ error: 'username and password(min 6) are required' });
  }

  if (!['admin', 'operator', 'analyst', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  if (!req.user.isSuperAdmin) {
    const permissionResult = await db.query(
      `SELECT role
       FROM app_user_roles
       WHERE app_id = $1
         AND user_id = $2
       LIMIT 1`,
      [appId, req.user.id]
    );

    if (permissionResult.rowCount === 0 || !hasMinimumRole(permissionResult.rows[0].role, 'admin')) {
      return res.status(403).json({ error: 'admin role required' });
    }
  }

  const passwordHash = await hashPassword(password);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const userInsert = await client.query(
      `INSERT INTO users (username, password_hash, display_name, is_active, is_super_admin)
       VALUES ($1, $2, $3, TRUE, FALSE)
       ON CONFLICT (username)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         is_active = TRUE
       RETURNING id, username, display_name`,
      [username, passwordHash, displayName]
    );

    const createdUser = userInsert.rows[0];

    await client.query(
      `INSERT INTO app_user_roles (app_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (app_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [appId, createdUser.id, role]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      user: createdUser,
      app_id: appId,
      role
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
