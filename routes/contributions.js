/**
 * routes/contributions.js
 *
 * POST /api/contributions        — submit a new contribution
 * GET  /api/contributions/mine   — current user's submission history
 * GET  /api/contributions/pending — pending queue (curator+)
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { KARMA, applyKarma, karmaEvent } = require('../karma');
const { requireActive, requireCurator } = require('../middleware');

// ── Submit ────────────────────────────────────────────────────────────────────

router.post('/', requireActive, async (req, res) => {
  const { poet_name, poet_bio, poet_wiki_url, poet_image_url,
          location_type, place_name, lat, lng } = req.body;

  if (!poet_name?.trim() || !place_name?.trim() || lat == null || lng == null) {
    return res.status(400).json({ error: 'poet_name, place_name, lat and lng are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-fetch user inside tx for up-to-date karma
    const { rows: [user] } = await client.query(
      'SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id]
    );

    const autoApprove = user.karma >= KARMA.AUTO_APPROVE_THRESHOLD;
    const status      = autoApprove ? 'approved' : 'pending';

    let poetId = null;

    if (autoApprove) {
      // Immediately write to poets + poet_locations
      const { rows: [poet] } = await client.query(
        `INSERT INTO poets (name, bio, wiki_url, image_url)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [poet_name.trim(), poet_bio||null, poet_wiki_url||null, poet_image_url||null]
      );
      poetId = poet.id;
      await client.query(
        `INSERT INTO poet_locations (poet_id, location_type, place_name, lat, lng)
         VALUES ($1,$2,$3,$4,$5)`,
        [poetId, location_type||'birthplace', place_name.trim(), lat, lng]
      );
    }

    const { rows: [contrib] } = await client.query(
      `INSERT INTO contributions
         (submitted_by, status, auto_approved, poet_id,
          poet_name, poet_bio, poet_wiki_url, poet_image_url,
          location_type, place_name, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [user.id, status, autoApprove, poetId,
       poet_name.trim(), poet_bio||null, poet_wiki_url||null, poet_image_url||null,
       location_type||'birthplace', place_name.trim(), lat, lng]
    );

    // Award karma
    const evt = karmaEvent(autoApprove ? 'auto_approved' : null);
    if (autoApprove) {
      await applyKarma(user.id, evt.delta, evt.reason, client);
    }

    await client.query('COMMIT');
    res.status(201).json({ contribution: contrib, auto_approved: autoApprove });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── My submissions ────────────────────────────────────────────────────────────

router.get('/mine', requireActive, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              u.display_name AS reviewer_name
       FROM contributions c
       LEFT JOIN users u ON u.id = c.reviewed_by
       WHERE c.submitted_by = $1
       ORDER BY c.submitted_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pending queue (curator+) ──────────────────────────────────────────────────

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
