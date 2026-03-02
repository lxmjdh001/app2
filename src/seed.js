const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { hashPassword, normalizeUsername } = require('./auth');

function parseArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

async function ensureDefaultAdmin(appId, usernameInput, passwordInput) {
  const username = normalizeUsername(usernameInput || 'admin');
  const password = String(passwordInput || 'admin123456');

  const passwordHash = await hashPassword(password);

  const userResult = await db.query(
    `INSERT INTO users (username, password_hash, display_name, is_active, is_super_admin)
     VALUES ($1, $2, $3, TRUE, TRUE)
     ON CONFLICT (username)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE,
       is_super_admin = TRUE,
       updated_at = NOW()
     RETURNING id, username`,
    [username, passwordHash, 'System Admin']
  );

  const adminUser = userResult.rows[0];

  await db.query(
    `INSERT INTO app_user_roles (app_id, user_id, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (app_id, user_id)
     DO UPDATE SET
       role = 'admin',
       updated_at = NOW()`,
    [appId, adminUser.id]
  );

  return {
    username: adminUser.username,
    password
  };
}

async function main() {
  const appName = parseArg('--name', 'local-demo-app');
  const adminUsernameArg = parseArg('--admin-username', 'admin');
  const adminPasswordArg = parseArg('--admin-password', 'admin123456');
  const apiKey = `app_${crypto.randomBytes(18).toString('hex')}`;

  const appResult = await db.query(
    `INSERT INTO apps (name, api_key)
     VALUES ($1, $2)
     RETURNING id, name, api_key`,
    [appName, apiKey]
  );

  const app = appResult.rows[0];

  await db.query(
    `INSERT INTO platform_configs (app_id, platform, enabled, config_json)
     VALUES
      ($1, 'facebook', FALSE, '{}'::jsonb),
      ($1, 'tiktok', FALSE, '{}'::jsonb)
     ON CONFLICT (app_id, platform) DO NOTHING`,
    [app.id]
  );

  await db.query(
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
    [app.id]
  );

  await db.query(
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
    [app.id, config.defaultAttributionRuleName, config.defaultAttributionLookbackHours]
  );

  await db.query(
    `INSERT INTO attribution_sql_queries
      (app_id, query_name, version, sql_template, is_active)
     VALUES
      ($1, 'attribution_overview', 1,
       'SELECT platform, count() AS total_jobs, countIf(status = ''done'') AS done_jobs, round(done_jobs / nullIf(total_jobs, 0), 4) AS done_rate FROM postback_jobs_analytics WHERE app_id = {{app_id}} AND updated_at >= toDateTime({{from}}) AND updated_at < toDateTime({{to}}) GROUP BY platform ORDER BY total_jobs DESC',
       TRUE)
     ON CONFLICT (app_id, query_name, version) DO NOTHING`,
    [app.id]
  );

  const admin = await ensureDefaultAdmin(app.id, adminUsernameArg, adminPasswordArg);

  console.log('Seed completed.');
  console.log('app_id:', app.id);
  console.log('app_name:', app.name);
  console.log('api_key:', app.api_key);
  console.log('admin_username:', admin.username);
  console.log('admin_password:', admin.password);
  console.log('Next: login via POST /auth/login and use JWT in admin console.');

  await db.pool.end();
}

main().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await db.pool.end();
  process.exit(1);
});
