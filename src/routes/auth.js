const express = require('express');
const { supabase, supabaseAuth } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { seedDemoData } = require('../lib/seed');
const { sendWelcomeEmail } = require('../lib/email');
const { requireCron } = require('../lib/auth');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public client config — anon key is safe to expose (used for the browser OAuth handshake).
router.get('/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
});

router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const { data: authData, error: authError } = await supabaseAuth.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(profile.id, 'signup', { role: profile.role });

    if (profile.role === 'swimmer') await seedDemoData(profile.id);
    sendWelcomeEmail(profile.email, profile.name);   // best-effort, non-blocking

    res.json({ success: true, user: profile, session: authData.session });
  } catch (e) { await logError(e, { route: 'signup' }); res.status(500).json({ error: e.message }); }
});

// Sync an OAuth (Google/Apple) user into a profile.
// First call (no role) returns needsRole if the profile doesn't exist yet;
// the client then re-calls with the chosen role to create it.
router.post('/auth/oauth-sync', async (req, res) => {
  try {
    const { accessToken, role } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'Missing access token' });

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) return res.status(401).json({ error: 'Invalid session' });

    const authUser = userData.user;
    const { data: existing } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
    if (existing) {
      await trackEvent(existing.id, 'login', { role: existing.role, provider: authUser.app_metadata?.provider });
      return res.json({ success: true, user: existing });
    }

    // Link by email: if a profile already exists for this email (e.g. they signed up
    // with email/password earlier), sign them into that same account instead of
    // creating a duplicate. The app keys data off profile.id, so this keeps history intact.
    if (authUser.email) {
      const { data: byEmail } = await supabase.from('profiles').select('*').eq('email', authUser.email).single();
      if (byEmail) {
        await trackEvent(byEmail.id, 'login', { role: byEmail.role, provider: authUser.app_metadata?.provider, linkedByEmail: true });
        return res.json({ success: true, user: byEmail });
      }
    }

    if (!role) {
      const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || (authUser.email || '').split('@')[0];
      return res.json({ needsRole: true, name, email: authUser.email });
    }

    const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || (authUser.email || '').split('@')[0];
    const finalRole = role === 'coach' ? 'coach' : 'swimmer';
    // If a coach invited this person by email, auto-link them on signup.
    const invitedByCoach = authUser.user_metadata?.invited_by_coach;
    const coachId = finalRole === 'swimmer' && invitedByCoach ? invitedByCoach : null;
    const { data: profile, error } = await supabase.from('profiles')
      .insert({ id: authUser.id, email: authUser.email, name, role: finalRole, coach_id: coachId })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(profile.id, 'signup', { role: profile.role, provider: authUser.app_metadata?.provider });
    if (profile.role === 'swimmer') await seedDemoData(profile.id);
    sendWelcomeEmail(profile.email, profile.name);   // best-effort, non-blocking

    res.json({ success: true, user: profile });
  } catch (e) { await logError(e, { route: 'oauth-sync' }); res.status(500).json({ error: e.message }); }
});

// Permanently delete a user's account + personal data.
// Required by the App Store for apps that offer account creation (5.1.1(v)).
router.post('/auth/delete-account', async (req, res) => {
  try {
    // Always act on the authenticated caller — never a client-supplied id.
    const userId = req.user.id;

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();

    // Order matters: every row that references profiles(id) must be cleared
    // before the profile itself, or the final delete fails the FK check.

    // active_goal_id -> goals(id): null it first so the goals delete below works.
    await supabase.from('profiles').update({ active_goal_id: null }).eq('id', userId);

    // Personal data keyed by swimmer_id.
    const swimmerTables = ['swim_times', 'goals', 'watch_workouts', 'watch_link_codes', 'meet_results', 'video_feedback', 'achievements', 'streaks', 'training_plans', 'batch_members', 'meet_recommendations', 'coach_routines', 'group_members', 'coach_comments', 'coach_badges'];
    for (const t of swimmerTables) {
      await supabase.from(t).delete().eq('swimmer_id', userId);
    }

    // Rows where this user is the coach.
    for (const t of ['video_feedback', 'coach_comments', 'coach_badges', 'meet_recommendations', 'coach_routines']) {
      await supabase.from(t).delete().eq('coach_id', userId);
    }

    // Analytics events (FK: analytics.user_id -> profiles.id) and coach links.
    await supabase.from('analytics').delete().eq('user_id', userId);
    await supabase.from('coach_requests').delete().or(`from_id.eq.${userId},to_id.eq.${userId}`);

    // Groups this user created → remove memberships, then the groups.
    const { data: ownedGroups } = await supabase.from('swimmer_groups').select('id').eq('created_by', userId);
    if (ownedGroups?.length) {
      await supabase.from('group_members').delete().in('group_id', ownedGroups.map(g => g.id));
      await supabase.from('swimmer_groups').delete().eq('created_by', userId);
    }

    // Meets this user created → remove their results, then the meets.
    const { data: ownedMeets } = await supabase.from('meets').select('id').eq('created_by', userId);
    if (ownedMeets?.length) {
      await supabase.from('meet_results').delete().in('meet_id', ownedMeets.map(m => m.id));
      await supabase.from('meets').delete().eq('created_by', userId);
    }

    if (profile?.role === 'coach') {
      await supabase.from('profiles').update({ coach_id: null }).eq('coach_id', userId);
      const { data: batches } = await supabase.from('coach_batches').select('id').eq('coach_id', userId);
      if (batches?.length) {
        await supabase.from('batch_members').delete().in('batch_id', batches.map(b => b.id));
        await supabase.from('coach_batches').delete().eq('coach_id', userId);
      }
    }

    // Finally remove the profile — and verify it actually went (FK violations
    // here used to be swallowed, leaving the name/email behind after "deletion").
    const { error: profErr } = await supabase.from('profiles').delete().eq('id', userId);
    if (profErr) {
      await logError(new Error(profErr.message), { route: 'delete-account', stage: 'profile-delete', userId });
      return res.status(400).json({ error: 'Could not fully delete account. Please contact support.' });
    }

    const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
    if (delErr) return res.status(400).json({ error: delErr.message });

    // Record the deletion with no user_id (the profile is gone).
    await trackEvent(null, 'account_deleted', { deletedUserId: userId });
    res.json({ success: true });
  } catch (e) { await logError(e, { route: 'delete-account' }); res.status(500).json({ error: e.message }); }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    await trackEvent(profile.id, 'login', { role: profile.role });
    res.json({ success: true, user: profile, session: data.session });
  } catch (e) { await logError(e, { route: 'login' }); res.status(500).json({ error: e.message }); }
});

router.post('/analytics/track', async (req, res) => {
  const { eventType, eventData } = req.body;
  await trackEvent(req.user.id, eventType, eventData);
  res.json({ success: true });
});

// Aggregate analytics across all users — server-operator only (requireCron).
// Powers the operator dashboard at /admin.html. `?days=N` sets the window
// (default 30, capped at 90). Aggregation is done in JS over a bounded recent
// slice, which is fine at the app's current scale; revisit with SQL rollups if
// the event volume outgrows the cap.
router.get('/analytics/summary', requireCron, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceISO = since.toISOString();

    const { data: events } = await supabase
      .from('analytics')
      .select('user_id, event_type, event_data, created_at')
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false })
      .limit(20000);

    const rows = events || [];
    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);          // YYYY-MM-DD (UTC)
    const cutoff = (n) => Date.now() - n * 24 * 60 * 60 * 1000;

    const byType = {};
    const users = new Set();
    const active7 = new Set();
    const active30 = new Set();
    const perDayMap = {};
    const recentErrors = [];

    for (const e of rows) {
      byType[e.event_type] = (byType[e.event_type] || 0) + 1;
      const t = new Date(e.created_at).getTime();
      if (e.user_id) {
        users.add(e.user_id);
        if (t >= cutoff(7)) active7.add(e.user_id);
        if (t >= cutoff(30)) active30.add(e.user_id);
      }
      perDayMap[dayKey(e.created_at)] = (perDayMap[dayKey(e.created_at)] || 0) + 1;
      if (e.event_type === 'error' && recentErrors.length < 15) {
        recentErrors.push({
          message: e.event_data?.message || 'Unknown error',
          context: e.event_data?.context || null,
          at: e.created_at,
        });
      }
    }

    // Dense per-day series for the whole window (zero-filled), oldest → newest.
    const perDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(cutoff(i));
      perDay.push({ date: key, count: perDayMap[key] || 0 });
    }

    res.json({
      windowDays: days,
      generatedAt: new Date().toISOString(),
      totalEvents: rows.length,
      uniqueUsers: users.size,
      activeUsers7d: active7.size,
      activeUsers30d: active30.size,
      newSignups: byType['signup'] || 0,
      logins: byType['login'] || 0,
      timesLogged: byType['time_logged'] || 0,
      errors: byType['error'] || 0,
      byType,
      perDay,
      recentEvents: rows.slice(0, 25).map(e => ({
        event_type: e.event_type, user_id: e.user_id, at: e.created_at,
      })),
      recentErrors,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
