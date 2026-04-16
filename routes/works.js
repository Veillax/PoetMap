const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/works?poet_id=1
router.get('/', async (req, res) => {
  try {
    const { poet_id } = req.query;
    const result = poet_id
      ? await pool.query('SELECT * FROM works WHERE poet_id = $1 ORDER BY year', [poet_id])
      : await pool.query('SELECT * FROM works ORDER BY year');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/works
router.post('/', async (req, res) => {
  try {
    const { poet_id, title, year, description, url } = req.body;
    const result = await pool.query(
      'INSERT INTO works (poet_id, title, year, description, url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [poet_id, title, year, description, url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/works/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, year, description, url } = req.body;
    const result = await pool.query(
      `UPDATE works SET
        title = COALESCE($1, title),
        year = COALESCE($2, year),
        description = COALESCE($3, description),
        url = COALESCE($4, url)
       WHERE id = $5 RETURNING *`,
      [title, year, description, url, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/works/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM works WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;