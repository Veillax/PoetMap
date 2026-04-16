/**
 * middleware.js — Reusable Express middleware
 */

/** Reject unauthenticated requests */
function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

/** Reject banned or timed-out users */
function requireActive(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const u = req.user;
  if (u.banned) return res.status(403).json({ error: 'Account banned' });
  if (u.timeout_until && new Date(u.timeout_until) > new Date()) {
    return res.status(403).json({ error: 'Account timed out', until: u.timeout_until });
  }
  next();
}

/** Require curator or admin role */
function requireCurator(req, res, next) {
  requireActive(req, res, () => {
    if (req.user.role !== 'curator' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Curator role required' });
    }
    next();
  });
}

/** Require admin role */
function requireAdmin(req, res, next) {
  requireActive(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    next();
  });
}

/**
 * Localhost-only gate — must come BEFORE session/passport so it cannot
 * be bypassed by a logged-in non-local session. Intended to sit behind
 * an nginx that does NOT proxy /admin, so only direct local connections
 * reach this route.
 */
function requireLocalhost(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '';
  const clean = ip.replace(/^::ffff:/, ''); // normalise IPv4-mapped
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') {
    return next();
  }
  // Return a plain 404 so the route doesn't even appear to exist externally
  res.status(404).send('Not found');
}

module.exports = { requireAuth, requireActive, requireCurator, requireAdmin, requireLocalhost };
