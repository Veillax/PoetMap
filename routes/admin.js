/**
 * routes/admin.js
 *
 * ALL routes here are guarded by requireLocalhost — they are never
 * reachable through the reverse proxy or open internet, only via direct local connection to the server.
 *
 * Users
 *   GET    /admin/api/users                    — list all users
 *   GET    /admin/api/users/:id                — single user + karma log
 *   PATCH  /admin/api/users/:id                — edit role, karma, ban, timeout
 *   DELETE /admin/api/users/:id                — hard-delete user
 *
 * Contributions
 *   GET    /admin/api/contributions            — all contributions (any status)
 *   GET    /admin/api/contributions/:id        — single contribution
 *   POST   /admin/api/contributions/:id/approve
 *   POST   /admin/api/contributions/:id/deny
 *   DELETE /admin/api/contributions/:id        — hard-delete + karma cost
 *
 * Stats
 *   GET    /admin/api/stats                    — quick dashboard numbers
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { applyKarma, karmaEvent } = require('../karma');
const { requireLocalhost } = require('../middleware');

// Apply localhost guard to every route in this file
router.use(requireLocalhost);

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, display_name, email, avatar_url,
              karma, role, banned, timeout_until, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/users/:id', async (req, res) => {
  try {
    const { rows: [user] } = await pool.query(
      `SELECT id, provider, display_name, email, avatar_url,
              karma, role, banned, timeout_until, created_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { rows: log } = await pool.query(
      `SELECT * FROM karma_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    const { rows: contribs } = await pool.query(
      `SELECT id, status, auto_approved, poet_name, place_name, submitted_at
       FROM contributions WHERE submitted_by = $1 ORDER BY submitted_at DESC`,
      [req.params.id]
    );

    res.json({ ...user, karma_log: log, contributions: contribs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/users/:id', async (req, res) => {
  try {
    const { role, karma, banned, timeout_until } = req.body;
    const { rows: [user] } = await pool.query(
      `UPDATE users SET
         role          = COALESCE($1, role),
         karma         = COALESCE($2, karma),
         banned        = COALESCE($3, banned),
         timeout_until = COALESCE($4::timestamptz, timeout_until)
       WHERE id = $5
       RETURNING id, display_name, role, karma, banned, timeout_until`,
      [role, karma, banned, timeout_until || null, req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Log manual karma edit if karma was explicitly changed
    if (karma != null) {
      await pool.query(
        `INSERT INTO karma_log (user_id, delta, reason, created_at)
         VALUES ($1, $2, 'Manual admin edit', NOW())`,
        [req.params.id, 0] // delta unknown, record event only
      );
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Contributions
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/contributions', async (req, res) => {
  try {
    const { status } = req.query; // optional filter
    const { rows } = await pool.query(
      `SELECT c.*,
              u.display_name  AS submitter_name,
              u.karma         AS submitter_karma,
              r.display_name  AS reviewer_name
       FROM contributions c
       JOIN users u ON u.id = c.submitted_by
       LEFT JOIN users r ON r.id = c.reviewed_by
       ${status ? 'WHERE c.status = $1' : ''}
       ORDER BY c.submitted_at DESC
       LIMIT 200`,
      status ? [status] : []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/contributions/:id', async (req, res) => {
  try {
    const { rows: [c] } = await pool.query(
      `SELECT c.*,
              u.display_name AS submitter_name,
              u.karma        AS submitter_karma
       FROM contributions c
       JOIN users u ON u.id = c.submitted_by
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/contributions/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [contrib] } = await client.query(
      `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!contrib) return res.status(404).json({ error: 'Not found' });
    if (contrib.status !== 'pending') {
      return res.status(409).json({ error: `Already ${contrib.status}` });
    }

    const { rows: [poet] } = await client.query(
      `INSERT INTO poets (name, bio, wiki_url, image_url) VALUES ($1,$2,$3,$4) RETURNING id`,
      [contrib.poet_name, contrib.poet_bio, contrib.poet_wiki_url, contrib.poet_image_url]
    );
    await client.query(
      `INSERT INTO poet_locations (poet_id, location_type, place_name, lat, lng)
       VALUES ($1,$2,$3,$4,$5)`,
      [poet.id, contrib.location_type, contrib.place_name, contrib.lat, contrib.lng]
    );
    await client.query(
      `UPDATE contributions SET status='approved', poet_id=$1, reviewed_at=NOW() WHERE id=$2`,
      [poet.id, contrib.id]
    );
    const { delta, reason } = karmaEvent('approved');
    await applyKarma(contrib.submitted_by, delta, reason, client);

    await client.query('COMMIT');
    res.json({ ok: true, poet_id: poet.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/api/contributions/:id/deny', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [contrib] } = await client.query(
      `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!contrib) return res.status(404).json({ error: 'Not found' });
    if (contrib.status !== 'pending') {
      return res.status(409).json({ error: `Already ${contrib.status}` });
    }

    await client.query(
      `UPDATE contributions SET status='denied', reviewed_at=NOW() WHERE id=$1`, [contrib.id]
    );
    const { delta, reason } = karmaEvent('denied');
    await applyKarma(contrib.submitted_by, delta, reason, client);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * Hard-delete a contribution. If it was auto-approved, the linked poet
 * is also removed and the increased karma cost applies.
 */
router.delete('/api/contributions/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [contrib] } = await client.query(
      `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!contrib) return res.status(404).json({ error: 'Not found' });

    // If the poet was already inserted (approved/auto-approved), delete it too
    if (contrib.poet_id) {
      await client.query('DELETE FROM poets WHERE id = $1', [contrib.poet_id]);
    }
    await client.query('DELETE FROM contributions WHERE id = $1', [contrib.id]);

    // Karma cost depends on whether it was auto-approved
    const evt = contrib.auto_approved ? karmaEvent('auto_deleted') : karmaEvent('deleted');
    await applyKarma(contrib.submitted_by, evt.delta, evt.reason, client);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/stats', async (req, res) => {
  try {
    const [users, poets, pending, approved, denied] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM poets'),
      pool.query(`SELECT COUNT(*) FROM contributions WHERE status='pending'`),
      pool.query(`SELECT COUNT(*) FROM contributions WHERE status='approved'`),
      pool.query(`SELECT COUNT(*) FROM contributions WHERE status='denied'`),
    ]);
    res.json({
      users:    +users.rows[0].count,
      poets:    +poets.rows[0].count,
      pending:  +pending.rows[0].count,
      approved: +approved.rows[0].count,
      denied:   +denied.rows[0].count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Serve the admin SPA (localhost only)
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

module.exports = router;
