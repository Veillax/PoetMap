/**
 * routes/curator.js
 *
 * POST /api/curator/approve/:id  — approve a pending contribution
 * POST /api/curator/deny/:id     — deny a pending contribution
 * GET  /api/curator/pending      — alias for convenience (same as contributions/pending)
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { applyKarma, karmaEvent } = require('../karma');
const { requireCurator } = require('../middleware');

// ── Approve ───────────────────────────────────────────────────────────────────

router.post('/approve/:id', requireCurator, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [contrib] } = await client.query(
      `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );

    if (!contrib) return res.status(404).json({ error: 'Contribution not found' });
    if (contrib.status !== 'pending') {
      return res.status(409).json({ error: `Contribution is already ${contrib.status}` });
    }

    let poetId;

    if (contrib.contribution_type === 'edit') {
      // Apply poet edits
      await client.query(
        `UPDATE poets SET
          name      = COALESCE($1, name),
          bio       = COALESCE($2, bio),
          wiki_url  = COALESCE($3, wiki_url),
          image_url = COALESCE($4, image_url)
         WHERE id = $5`,
        [contrib.poet_name, contrib.poet_bio, contrib.poet_wiki_url, contrib.poet_image_url, contrib.poet_id]
      );

      // Apply works from edit_payload
      const payload = contrib.edit_payload || {};
      if (Array.isArray(payload.works)) {
        for (const w of payload.works) {
          if (w._delete && w.id) {
            await client.query('DELETE FROM works WHERE id = $1 AND poet_id = $2', [w.id, contrib.poet_id]);
          } else if (w.id) {
            await client.query(
              `UPDATE works SET title=$1, year=$2, description=$3, url=$4 WHERE id=$5 AND poet_id=$6`,
              [w.title||null, w.year||null, w.description||null, w.url||null, w.id, contrib.poet_id]
            );
          } else if (w.title) {
            await client.query(
              `INSERT INTO works (poet_id, title, year, description, url) VALUES ($1,$2,$3,$4,$5)`,
              [contrib.poet_id, w.title, w.year||null, w.description||null, w.url||null]
            );
          }
        }
      }

      poetId = contrib.poet_id;
    } else {
      // Write poet + location (original flow)
      const { rows: [poet] } = await client.query(
        `INSERT INTO poets (name, bio, wiki_url, image_url)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [contrib.poet_name, contrib.poet_bio, contrib.poet_wiki_url, contrib.poet_image_url]
      );
      await client.query(
        `INSERT INTO poet_locations (poet_id, location_type, place_name, lat, lng)
         VALUES ($1,$2,$3,$4,$5)`,
        [poet.id, contrib.location_type, contrib.place_name, contrib.lat, contrib.lng]
      );
      poetId = poet.id;
    }

    // Update contribution record
    await client.query(
      `UPDATE contributions SET
         status = 'approved', poet_id = $1,
         reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [poetId, req.user.id, contrib.id]
    );

    // Karma reward
    const { delta, reason } = karmaEvent('approved');
    await applyKarma(contrib.submitted_by, delta, reason, client);

    await client.query('COMMIT');
    res.json({ ok: true, poet_id: poet.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Deny ──────────────────────────────────────────────────────────────────────

router.post('/deny/:id', requireCurator, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [contrib] } = await client.query(
      `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );

    if (!contrib) return res.status(404).json({ error: 'Contribution not found' });
    if (contrib.status !== 'pending') {
      return res.status(409).json({ error: `Contribution is already ${contrib.status}` });
    }

    await client.query(
      `UPDATE contributions SET
         status = 'denied', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [req.user.id, contrib.id]
    );

    const { delta, reason } = karmaEvent('denied');
    await applyKarma(contrib.submitted_by, delta, reason, client);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Pending (convenience alias) ───────────────────────────────────────────────

router.get('/pending', requireCurator, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              u.display_name AS submitter_name,
              u.karma        AS submitter_karma,
              u.avatar_url   AS submitter_avatar
       FROM contributions c
       JOIN users u ON u.id = c.submitted_by
       WHERE c.status = 'pending'
       ORDER BY c.submitted_at ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
