const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/poets — list all poets (lightweight, no joins)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM poets ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/poets/map — full joined data for the map
router.get('/map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id, p.name, p.bio, p.image_url, p.wiki_url,
        json_agg(DISTINCT jsonb_build_object(
          'id', pl.id,
          'location_type', pl.location_type,
          'place_name', pl.place_name,
          'lat', pl.lat,
          'lng', pl.lng
        )) AS locations,
        json_agg(DISTINCT jsonb_build_object(
          'id', w.id,
          'title', w.title,
          'year', w.year,
          'description', w.description,
          'url', w.url
        )) AS works
      FROM poets p
      LEFT JOIN poet_locations pl ON pl.poet_id = p.id
      LEFT JOIN works w ON w.poet_id = p.id
      GROUP BY p.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/poets/:id — single poet with all their data
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const poet = await pool.query('SELECT * FROM poets WHERE id = $1', [id]);
    if (poet.rows.length === 0) return res.status(404).json({ error: 'Poet not found' });

    const locations = await pool.query('SELECT * FROM poet_locations WHERE poet_id = $1', [id]);
    const works = await pool.query('SELECT * FROM works WHERE poet_id = $1 ORDER BY year', [id]);

    res.json({ ...poet.rows[0], locations: locations.rows, works: works.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/poets — create a poet
router.post('/', async (req, res) => {
  try {
    const { name, bio, image_url, wiki_url } = req.body;
    const result = await pool.query(
      'INSERT INTO poets (name, bio, image_url, wiki_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, bio, image_url, wiki_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/poets/:id — update a poet
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, bio, image_url, wiki_url } = req.body;
    const result = await pool.query(
      `UPDATE poets SET
        name = COALESCE($1, name),
        bio = COALESCE($2, bio),
        image_url = COALESCE($3, image_url),
        wiki_url = COALESCE($4, wiki_url)
       WHERE id = $5 RETURNING *`,
      [name, bio, image_url, wiki_url, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Poet not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/poets/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM poets WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;