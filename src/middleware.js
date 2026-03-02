const db = require('./db');
const config = require('./config');

function readApiKey(req) {
  return req.header('x-api-key') || req.query.app_key || req.body?.app_key || null;
}

async function resolveApp(req, res, next) {
  const apiKey = readApiKey(req);

  if (!apiKey && !config.localDevAllowAnon) {
    return res.status(401).json({ error: 'x-api-key or app_key is required' });
  }

  try {
    if (!apiKey && config.localDevAllowAnon) {
      const fallback = await db.query(
        `SELECT id, name, api_key
         FROM apps
         WHERE is_active = TRUE
         ORDER BY id ASC
         LIMIT 1`
      );
      const app = fallback.rows[0];
      if (!app) {
        return res.status(400).json({
          error: 'No active app found. Run npm run seed first to create one.'
        });
      }
      req.appTenant = app;
      req.authType = 'app_key';
      return next();
    }

    const result = await db.query(
      `SELECT id, name, api_key
       FROM apps
       WHERE api_key = $1
         AND is_active = TRUE
       LIMIT 1`,
      [apiKey]
    );

    const app = result.rows[0];
    if (!app) {
      return res.status(401).json({ error: 'Invalid api key' });
    }

    req.appTenant = app;
    req.authType = 'app_key';
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function resolveAdminApp(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  const appIdRaw = req.header('x-app-id') || req.query.app_id || req.body?.app_id || null;

  try {
    if (req.user.isSuperAdmin) {
      let appId = Number.parseInt(String(appIdRaw || ''), 10);

      if (!Number.isFinite(appId) || appId <= 0) {
        const firstApp = await db.query(
          `SELECT id, name
           FROM apps
           WHERE is_active = TRUE
           ORDER BY id ASC
           LIMIT 1`
        );

        if (firstApp.rowCount === 0) {
          return res.status(404).json({ error: 'No app available' });
        }

        appId = Number(firstApp.rows[0].id);
      }

      const appResult = await db.query(
        `SELECT id, name
         FROM apps
         WHERE id = $1
           AND is_active = TRUE
         LIMIT 1`,
        [appId]
      );

      if (appResult.rowCount === 0) {
        return res.status(404).json({ error: 'App not found' });
      }

      req.appTenant = appResult.rows[0];
      req.userRole = 'admin';
      req.authType = 'jwt';
      return next();
    }

    if (!appIdRaw) {
      const memberships = await db.query(
        `SELECT r.app_id, a.name AS app_name, r.role
         FROM app_user_roles r
         JOIN apps a ON a.id = r.app_id
         WHERE r.user_id = $1
           AND a.is_active = TRUE
         ORDER BY r.app_id`,
        [req.user.id]
      );

      if (memberships.rowCount === 0) {
        return res.status(403).json({ error: 'No app role assigned' });
      }

      if (memberships.rowCount > 1) {
        return res.status(400).json({ error: 'x-app-id is required for multi-app users' });
      }

      req.appTenant = {
        id: memberships.rows[0].app_id,
        name: memberships.rows[0].app_name
      };
      req.userRole = memberships.rows[0].role;
      req.authType = 'jwt';
      return next();
    }

    const appId = Number.parseInt(String(appIdRaw), 10);
    if (!Number.isFinite(appId) || appId <= 0) {
      return res.status(400).json({ error: 'invalid x-app-id' });
    }

    const membership = await db.query(
      `SELECT r.app_id, a.name AS app_name, r.role
       FROM app_user_roles r
       JOIN apps a ON a.id = r.app_id
       WHERE r.user_id = $1
         AND r.app_id = $2
         AND a.is_active = TRUE
       LIMIT 1`,
      [req.user.id, appId]
    );

    if (membership.rowCount === 0) {
      return res.status(403).json({ error: 'No permission for app' });
    }

    req.appTenant = {
      id: membership.rows[0].app_id,
      name: membership.rows[0].app_name
    };
    req.userRole = membership.rows[0].role;
    req.authType = 'jwt';

    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  resolveApp,
  resolveAdminApp,
  readApiKey
};
