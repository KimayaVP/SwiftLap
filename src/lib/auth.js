const crypto = require('crypto');
const { supabase } = require('../db');

// Paths (relative to the /api mount) that do NOT require a logged-in user.
// - health/config: needed before login
// - auth/*: the login/signup endpoints themselves
// - video/cleanup + analytics/summary: server-operator only, guarded by
//   requireCron (a shared secret) inside their routers
// - watch/verify-code + watch/workout: the Apple Watch has no user session;
//   it proves linkage via a 4-digit code + watch_linked_at instead (see watch.js)
const PUBLIC_PATHS = new Set([
  '/health',
  '/config',
  '/auth/signup',
  '/auth/login',
  '/auth/oauth-sync',
  '/video/cleanup',
  '/analytics/summary',
  '/watch/verify-code',
  '/watch/workout',
]);

// Authentication gate for everything under /api. Verifies the caller's Supabase
// access token server-side and loads their profile into req.user, so route
// handlers never have to trust a client-supplied id. Public paths pass through.
async function authGate(req, res, next) {
  const path = req.path.replace(/\/+$/, '') || '/';
  if (PUBLIC_PATHS.has(path)) return next();

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, coach_id, email')
      .eq('id', data.user.id)
      .single();
    if (!profile) return res.status(401).json({ error: 'Profile not found' });

    req.user = profile;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Guards server-operator endpoints (cron jobs / admin) with a shared secret.
function requireCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// MARK: authorization helpers

function isSelf(req, id) {
  return !!(req.user && id && req.user.id === id);
}

function isCoach(req) {
  return req.user?.role === 'coach';
}

async function coachOwnsSwimmer(coachId, swimmerId) {
  if (!coachId || !swimmerId) return false;
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', swimmerId)
    .eq('coach_id', coachId)
    .single();
  return !!data;
}

async function coachOwnsBatch(coachId, batchId) {
  if (!coachId || !batchId) return false;
  const { data } = await supabase
    .from('coach_batches')
    .select('id')
    .eq('id', batchId)
    .eq('coach_id', coachId)
    .single();
  return !!data;
}

async function inGroup(swimmerId, groupId) {
  if (!swimmerId || !groupId) return false;
  const { data } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('group_id', groupId)
    .eq('swimmer_id', swimmerId)
    .single();
  return !!data;
}

// True if the caller is the swimmer themselves, or a coach who owns them.
async function canAccessSwimmer(req, swimmerId) {
  if (isSelf(req, swimmerId)) return true;
  if (isCoach(req)) return await coachOwnsSwimmer(req.user.id, swimmerId);
  return false;
}

function forbidden(res) {
  return res.status(403).json({ error: 'Not authorized' });
}

// MARK: per-device watch tokens
// The Apple Watch has no user login — it pairs via a 4-digit code. On a
// successful pair we hand it an HMAC-signed token tying the device to a
// swimmer; it presents this on every workout sync so we can authenticate the
// device (and derive the swimmer) without trusting a client-supplied id.
// Stateless (no DB column): the signature is verified, and unlink still
// revokes because /watch/workout also checks profiles.watch_linked_at.
const watchSecret = () => process.env.WATCH_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'swiftlap-dev-secret';

function signWatchToken(swimmerId) {
  const sig = crypto.createHmac('sha256', watchSecret()).update(String(swimmerId)).digest('hex');
  return `${swimmerId}.${sig}`;
}

function verifyWatchToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const swimmerId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', watchSecret()).update(swimmerId).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try { return crypto.timingSafeEqual(a, b) ? swimmerId : null; } catch { return null; }
}

module.exports = {
  authGate,
  requireCron,
  isSelf,
  isCoach,
  coachOwnsSwimmer,
  coachOwnsBatch,
  inGroup,
  canAccessSwimmer,
  forbidden,
  signWatchToken,
  verifyWatchToken,
};
