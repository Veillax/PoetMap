/**
 * karma.js — Karma constants and mutation helpers
 *
 * Thresholds & deltas:
 *  - contribution approved (normal):      +10
 *  - contribution denied/deleted:         −5
 *  - auto-approve threshold:              50
 *  - contribution approved (auto):        +6   (slightly reduced reward)
 *  - auto-approved contribution deleted:  −8   (slightly increased cost)
 *
 * Auto-approve:  user karma >= AUTO_APPROVE_THRESHOLD at submission time
 */

const pool = require('./db');

const KARMA = {
  APPROVED:          10,
  DENIED:            -5,
  DELETED:           -5,
  AUTO_APPROVED:      6,   // reward when auto-approved
  AUTO_DELETED:      -8,   // cost when auto-approved contribution is later deleted
  AUTO_APPROVE_THRESHOLD: 50,
};

/**
 * Apply a karma delta to a user and log it.
 * @param {number} userId
 * @param {number} delta  - positive or negative integer
 * @param {string} reason - short description for the log
 * @param {object} [client] - optional pg transaction client; uses pool if omitted
 */
async function applyKarma(userId, delta, reason, client) {
  const db = client || pool;
  await db.query(
    `UPDATE users SET karma = GREATEST(0, karma + $1) WHERE id = $2`,
    [delta, userId]
  );
  await db.query(
    `INSERT INTO karma_log (user_id, delta, reason, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [userId, delta, reason]
  );
}

/**
 * Return the karma delta and reason string for a given event.
 * @param {'approved'|'denied'|'deleted'|'auto_approved'|'auto_deleted'} event
 */
function karmaEvent(event) {
  const map = {
    approved:     { delta: KARMA.APPROVED,     reason: 'Contribution approved' },
    denied:       { delta: KARMA.DENIED,        reason: 'Contribution denied' },
    deleted:      { delta: KARMA.DELETED,       reason: 'Contribution deleted' },
    auto_approved:{ delta: KARMA.AUTO_APPROVED, reason: 'Contribution auto-approved' },
    auto_deleted: { delta: KARMA.AUTO_DELETED,  reason: 'Auto-approved contribution deleted' },
  };
  return map[event] || { delta: 0, reason: event };
}

module.exports = { KARMA, applyKarma, karmaEvent };

/* ── Database migrations (run once) ──────────────────────────────────────────

-- Add karma + role columns to users table (from auth.js migration):
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS karma    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS role     VARCHAR(20) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS banned   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS timeout_until TIMESTAMPTZ;

-- roles: 'user' | 'curator' | 'admin'

-- Karma audit log:
CREATE TABLE IF NOT EXISTS karma_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contributions queue:
CREATE TABLE IF NOT EXISTS contributions (
  id             SERIAL PRIMARY KEY,
  submitted_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- status: 'pending' | 'approved' | 'denied' | 'deleted'
  auto_approved  BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  poet_id        INTEGER REFERENCES poets(id) ON DELETE SET NULL,
  -- snapshot of submitted data (stored even if poet is later deleted)
  poet_name      TEXT NOT NULL,
  poet_bio       TEXT,
  poet_wiki_url  TEXT,
  poet_image_url TEXT,
  location_type  VARCHAR(30),
  place_name     TEXT,
  lat            NUMERIC(10,6),
  lng            NUMERIC(10,6),
  submitted_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contributions_status_idx ON contributions(status);
CREATE INDEX IF NOT EXISTS contributions_submitted_by_idx ON contributions(submitted_by);
*/
