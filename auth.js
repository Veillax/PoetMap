require('dotenv').config();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const pool = require('./db');

// ── Serialize / Deserialize ──────────────────────────────────────────────────

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    done(null, rows[0] || null);
  } catch (err) {
    done(err, null);
  }
});

// ── Helper: upsert OAuth user ────────────────────────────────────────────────

async function findOrCreateUser({ provider, provider_id, display_name, email, avatar_url }) {
  // Try to find existing user by provider + provider_id
  const existing = await pool.query(
    'SELECT * FROM users WHERE provider = $1 AND provider_id = $2',
    [provider, provider_id]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // Create new user
  const { rows } = await pool.query(
    `INSERT INTO users (provider, provider_id, display_name, email, avatar_url, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [provider, provider_id, display_name, email || null, avatar_url || null]
  );
  return rows[0];
}

// ── Google Strategy ──────────────────────────────────────────────────────────

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateUser({
        provider:     'google',
        provider_id:  profile.id,
        display_name: profile.displayName,
        email:        profile.emails?.[0]?.value,
        avatar_url:   profile.photos?.[0]?.value,
      });
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }
));

// ── GitHub Strategy ──────────────────────────────────────────────────────────

passport.use(new GitHubStrategy(
  {
    clientID:     process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL:  process.env.GITHUB_CALLBACK_URL || '/auth/github/callback',
    scope:        ['user:email'],
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateUser({
        provider:     'github',
        provider_id:  String(profile.id),
        display_name: profile.displayName || profile.username,
        email:        profile.emails?.[0]?.value,
        avatar_url:   profile.photos?.[0]?.value,
      });
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }
));

// ── Auth Routes (mounted at /auth) ───────────────────────────────────────────

const express = require('express');
const router  = express.Router();

// Google
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?auth=error' }),
  (req, res) => {
  req.logIn(req.user, (err) => {
    if (err) {
      console.error("LOGIN ERROR:", err);
      return res.redirect('/?auth=error');
    }

    return res.redirect('/?auth=success');
  });
}
);

// GitHub
router.get('/github',
  passport.authenticate('github', { scope: ['user:email'] })
);
router.get('/github/callback',
  passport.authenticate('github', { failureRedirect: '/?auth=error' }),
  (req, res) => {
  req.logIn(req.user, (err) => {
    if (err) {
      console.error("LOGIN ERROR:", err);
      return res.redirect('/?auth=error');
    }

    return res.redirect('/?auth=success');
  });
}
);

// Current user (JSON — used by frontend) 
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      id:           req.user.id,
      display_name: req.user.display_name,
      avatar_url:   req.user.avatar_url,
      provider:     req.user.provider,
      role:         req.user.role || 'user'
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Logout
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});

module.exports = { passport, router };
