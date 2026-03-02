const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

const roleOrder = {
  viewer: 10,
  analyst: 20,
  operator: 30,
  admin: 40
};

function roleRank(role) {
  return roleOrder[String(role || '').toLowerCase()] || 0;
}

function hasMinimumRole(role, requiredRole) {
  return roleRank(role) >= roleRank(requiredRole);
}

function hasAnyRole(role, allowedRoles = []) {
  return allowedRoles.some((allowed) => hasMinimumRole(role, allowed));
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(String(plainPassword), 10);
}

async function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compare(String(plainPassword), String(passwordHash || ''));
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      display_name: user.display_name || null
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function parseBearerToken(req) {
  const authHeader = req.header('authorization') || req.header('Authorization');
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}

async function requireJwt(req, res, next) {
  const token = parseBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Bearer token required' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const userId = Number.parseInt(String(payload.sub), 10);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid token subject' });
    }

    const result = await db.query(
      `SELECT id, username, display_name, is_active, is_super_admin
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    if (result.rowCount === 0 || result.rows[0].is_active !== true) {
      return res.status(401).json({ error: 'User not active' });
    }

    req.user = {
      id: result.rows[0].id,
      username: result.rows[0].username,
      displayName: result.rows[0].display_name,
      isSuperAdmin: result.rows[0].is_super_admin
    };
    req.authType = 'jwt';

    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function listUserAppRoles(userId) {
  const result = await db.query(
    `SELECT r.app_id, a.name AS app_name, r.role
     FROM app_user_roles r
     JOIN apps a ON a.id = r.app_id
     WHERE r.user_id = $1
       AND a.is_active = TRUE
     ORDER BY a.id`,
    [userId]
  );

  return result.rows;
}

module.exports = {
  roleRank,
  hasMinimumRole,
  hasAnyRole,
  normalizeUsername,
  hashPassword,
  comparePassword,
  signToken,
  requireJwt,
  listUserAppRoles
};
