const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { seedDemoData } = require('../lib/seed');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public client config — anon key is safe to expose (used for the browser OAuth handshake).
router.get('/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
});

router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(profile.id, 'signup', { role: profile.role });

    if (profile.role === 'swimmer') await seedDemoData(profile.id);

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

    res.json({ success: true, user: profile });
  } catch (e) { await logError(e, { route: 'oauth-sync' }); res.status(500).json({ error: e.message }); }
});

// Permanently delete a user's account + personal data.
// Required by the App Store for apps that offer account creation (5.1.1(v)).
router.post('/auth/delete-account', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();

    // Personal data keyed by swimmer_id (best-effort per table).
    const swimmerTables = ['swim_times', 'goals', 'watch_workouts', 'meet_results', 'video_feedback', 'achievements', 'streaks', 'training_plans', 'batch_members', 'meet_recommendations', 'coach_routines'];
    for (const t of swimmerTables) {
      await supabase.from(t).delete().eq('swimmer_id', userId);
    }
    await supabase.from('coach_requests').delete().or(`from_id.eq.${userId},to_id.eq.${userId}`);
    await supabase.from('comments').delete().or(`swimmer_id.eq.${userId},coach_id.eq.${userId}`);

    if (profile?.role === 'coach') {
      await supabase.from('profiles').update({ coach_id: null }).eq('coach_id', userId);
      await supabase.from('coach_batches').delete().eq('coach_id', userId);
      await supabase.from('meet_recommendations').delete().eq('coach_id', userId);
      await supabase.from('coach_routines').delete().eq('coach_id', userId);
    }

    await supabase.from('profiles').delete().eq('id', userId);
    const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
    if (delErr) return res.status(400).json({ error: delErr.message });

    await trackEvent(userId, 'account_deleted', {});
    res.json({ success: true });
  } catch (e) { await logError(e, { route: 'delete-account' }); res.status(500).json({ error: e.message }); }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    await trackEvent(profile.id, 'login', { role: profile.role });
    res.json({ success: true, user: profile, session: data.session });
  } catch (e) { await logError(e, { route: 'login' }); res.status(500).json({ error: e.message }); }
});

router.post('/analytics/track', async (req, res) => {
  const { userId, eventType, eventData } = req.body;
  await trackEvent(userId, eventType, eventData);
  res.json({ success: true });
});

router.get('/analytics/summary', async (req, res) => {
  try {
    const { data: events } = await supabase.from('analytics').select('*').order('created_at', { ascending: false }).limit(100);
    const summary = { totalEvents: events?.length || 0, byType: {}, recentErrors: [] };
    (events || []).forEach(e => { summary.byType[e.event_type] = (summary.byType[e.event_type] || 0) + 1; });
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
