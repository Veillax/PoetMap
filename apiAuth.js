/**
 * apiAuth.js — API token validation + in-memory rate limiting
 *
 * Rate limits (designed for a self-hosted homelab):
 *   Authenticated (token):  300 req / 15 min per token
 *   Unauthenticated:         60 req / 15 min per IP   (read-only public routes)
 *
 * Strategy: sliding-window counter stored in-memory (Map).
 * Fine for a single-process homelab. If you ever run multiple workers,
 * swap the Map for a Redis INCR + EXPIRE.
 */

const crypto = require('crypto');
const pool   = require('./db');

// ── In-memory rate-limit store ────────────────────────────────────────────────

const WINDOW_MS   = 15 * 60 * 1000;  // 15 minutes
const LIMIT_AUTH  = 300;              // requests per window for token users
const LIMIT_ANON  = 60;              // requests per window for anonymous IPs

const rateLimitStore = new Map(); // key → { count, windowStart }

/** Increment counter; return { allowed, remaining, resetAt } */
function checkRateLimit(key, limit) {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }

  entry.count += 1;
  rateLimitStore.set(key, entry);

  const remaining = Math.max(0, limit - entry.count);
  const resetAt   = new Date(entry.windowStart + WINDOW_MS).toISOString();

  return { allowed: entry.count <= limit, remaining, resetAt, limit };
}

// Prune stale entries every 30 minutes so the Map doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, entry] of rateLimitStore) {
    if (entry.windowStart < cutoff) rateLimitStore.delete(key);
  }
}, 30 * 60 * 1000);

// ── Token lookup (cached for 60 s to avoid a DB hit every request) ───────────

const tokenCache = new Map(); // hash → { userId, tokenId, expiresAt }
const TOKEN_CACHE_TTL = 60 * 1000;

async function resolveToken(raw) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const cached = tokenCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { rows } = await pool.query(
    'SELECT id, user_id FROM api_tokens WHERE token_hash = $1',
    [hash]
  );
  if (rows.length === 0) {
    tokenCache.set(hash, { data: null, expiresAt: Date.now() + TOKEN_CACHE_TTL });
    return null;
  }

  const data = { tokenId: rows[0].id, userId: rows[0].user_id };
  tokenCache.set(hash, { data, expiresAt: Date.now() + TOKEN_CACHE_TTL });
  return data;
}

/** Fire-and-forget: update last_used_at and request_count */
function recordUsage(tokenId) {
  pool.query(
    `UPDATE api_tokens
     SET last_used_at = NOW(),
         request_count = request_count + 1
     WHERE id = $1`,
    [tokenId]
  ).catch(() => {}); // non-critical
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * requireApiToken(req, res, next)
 *
 * Validates the Bearer token from Authorization header.
 * On success sets req.apiUserId and req.apiTokenId.
 * Enforces per-token rate limit.
 */
async function requireApiToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!raw) {
    return res.status(401).json({
      error: 'Missing API token',
      hint:  'Pass your token as: Authorization: Bearer pm_...'
    });
  }

  let tokenData;
  try {
    tokenData = await resolveToken(raw);
  } catch (err) {
    return res.status(500).json({ error: 'Token validation failed' });
  }

  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid or revoked API token' });
  }

  const rl = checkRateLimit(`token:${tokenData.tokenId}`, LIMIT_AUTH);
  setRateLimitHeaders(res, rl);

  if (!rl.allowed) {
    return res.status(429).json({
      error:     'Rate limit exceeded',
      limit:     rl.limit,
      remaining: 0,
      reset_at:  rl.resetAt,
    });
  }

  recordUsage(tokenData.tokenId);
  req.apiUserId  = tokenData.userId;
  req.apiTokenId = tokenData.tokenId;
  next();
}

/**
 * apiRateLimit(req, res, next)
 *
 * Lighter gate for public (no-token) API routes.
 * Limits by IP. Does NOT require authentication.
 */
function apiRateLimit(req, res, next) {
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  const rl = checkRateLimit(`ip:${ip}`, LIMIT_ANON);
  setRateLimitHeaders(res, rl);

  if (!rl.allowed) {
    return res.status(429).json({
      error:     'Rate limit exceeded',
      hint:      'Obtain an API token at /account for a higher limit',
      limit:     rl.limit,
      remaining: 0,
      reset_at:  rl.resetAt,
    });
  }
  next();
}

function setRateLimitHeaders(res, rl) {
  res.set('X-RateLimit-Limit',     String(rl.limit));
  res.set('X-RateLimit-Remaining', String(rl.remaining));
  res.set('X-RateLimit-Reset',     rl.resetAt);
}

module.exports = { requireApiToken, apiRateLimit };
