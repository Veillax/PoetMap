const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/locations?poet_id=1
router.get('/', async (req, res) => {
  try {
    const { poet_id } = req.query;
    const result = poet_id
      ? await pool.query('SELECT * FROM poet_locations WHERE poet_id = $1', [poet_id])
      : await pool.query('SELECT * FROM poet_locations');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/locations/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM poet_locations WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Location not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/locations
router.post('/', async (req, res) => {
  try {
    const { poet_id, location_type, place_name, lat, lng } = req.body;
    const result = await pool.query(
      `INSERT INTO poet_locations (poet_id, location_type, place_name, lat, lng)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [poet_id, location_type, place_name, lat, lng]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/locations/:id
router.patch('/:id', async (req, res) => {
  try {
    const { location_type, place_name, lat, lng } = req.body;
    const result = await pool.query(
      `UPDATE poet_locations SET
        location_type = COALESCE($1, location_type),
        place_name = COALESCE($2, place_name),
        lat = COALESCE($3, lat),
        lng = COALESCE($4, lng)
       WHERE id = $5 RETURNING *`,
      [location_type, place_name, lat, lng, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Location not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/locations/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM poet_locations WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;