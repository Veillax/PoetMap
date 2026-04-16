/**
 * routes/tokens.js — API token management
 * Mounted at /account/tokens (token CRUD) and used internally by middleware
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const pool    = require('../db');
const { requireAuth } = require('../middleware');

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateToken() {
  // Format: pm_<32 random hex bytes>  (pm = poetmap)
  return 'pm_' + crypto.randomBytes(32).toString('hex');
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET  /account/tokens  — list caller's tokens (never returns raw token)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, token_prefix, created_at, last_used_at, request_count
       FROM api_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /account/tokens  — create a new token
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Token name is required' });
    }

    // Limit tokens per user (reasonable for self-hosted)
    const { rows: existing } = await pool.query(
      'SELECT COUNT(*) FROM api_tokens WHERE user_id = $1',
      [req.user.id]
    );
    if (parseInt(existing[0].count, 10) >= 10) {
      return res.status(400).json({ error: 'Maximum of 10 tokens per user' });
    }

    const raw   = generateToken();
    const hash  = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix = raw.slice(0, 10); // "pm_" + 7 chars — shown in list

    const { rows } = await pool.query(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, name, token_prefix, created_at`,
      [req.user.id, name.trim(), hash, prefix]
    );

    // Return the raw token ONCE — it will never be retrievable again
    res.status(201).json({ ...rows[0], token: raw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /account/tokens/:id  — revoke a token
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM api_tokens WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
