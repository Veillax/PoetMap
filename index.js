require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { passport, router: authRouter } = require('./auth');
const pool = require('./db');
const { apiRateLimit } = require('./apiAuth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Sessions (required for Passport) ────────────────────────────────────────
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'change-me-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
// ── Passport ─────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static('public'));

// ── Auth Routes ───────────────────────────────────────────────────────────────
app.use('/auth', authRouter);

// ── Account / Token management ────────────────────────────────────────────────
app.use('/account/tokens', require('./routes/tokens'));

// ── Public API routes (IP-rate-limited, no token required for reads) ─────────
app.use('/api/poets',     apiRateLimit, require('./routes/poets.js'));
app.use('/api/locations', apiRateLimit, require('./routes/locations'));
app.use('/api/works',     apiRateLimit, require('./routes/works'));

// ── Authenticated API routes ──────────────────────────────────────────────────
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/curator',       require('./routes/curator'));


// ── Page routes (serve HTML from /account and /docs) ─────────────────────────
const path = require('path');
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, 'public', 'account.html')));
app.get('/docs',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')));
// ── Admin — localhost only ────────────────────────────────────────────────────
app.use('/admin', require('./routes/admin'));

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));