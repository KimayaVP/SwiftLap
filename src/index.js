require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Canonical host. swiftlap.in is the official home; Render's default
// *.onrender.com subdomain can't be removed, so instead we permanently (301)
// bounce any browser that opens it over to https://swiftlap.in (same path) —
// this is what redirects people who were given the old Render link.
// Deliberately skipped: /api (so any app client still pinned to the Render URL
// keeps working — a 301 can rewrite a POST to a GET) and /healthz (the
// keepalive ping must wake *this* dyno). GET/HEAD only, for the same reason.
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  const isRender = host.endsWith('.onrender.com');
  const isApiOrHealth = req.path.startsWith('/api') || req.path === '/healthz';
  const isReadNav = req.method === 'GET' || req.method === 'HEAD';
  if (isRender && isReadNav && !isApiOrHealth) {
    return res.redirect(301, 'https://swiftlap.in' + req.originalUrl);
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Liveness probe pinged by the keepalive GitHub Action so the Render
// free-tier dyno never sleeps during pool hours. Must stay cheap — no DB.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Authentication gate: verifies the caller's Supabase token and loads their
// profile into req.user for every /api route except a small public allowlist
// (health, config, login/signup, cron + watch device endpoints). Route handlers
// then enforce per-resource authorization against req.user.
app.use('/api', require('./lib/auth').authGate);

// Mount all API routes under /api. Each router contains its own
// path prefix (e.g. /goals, /watch) so the mount point is just /api.
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/achievements'));
app.use('/api', require('./routes/coach'));
app.use('/api', require('./routes/leaderboard'));
app.use('/api', require('./routes/insights'));
app.use('/api', require('./routes/training'));
app.use('/api', require('./routes/times'));
app.use('/api', require('./routes/goals'));
app.use('/api', require('./routes/video'));
app.use('/api', require('./routes/requests'));
app.use('/api', require('./routes/groups'));
app.use('/api', require('./routes/batches'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/comments'));
app.use('/api', require('./routes/coachBadges'));
app.use('/api', require('./routes/meets'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/watch'));

app.listen(PORT, () => console.log(`\n🏊 SwiftLap at http://localhost:${PORT}\n`));
