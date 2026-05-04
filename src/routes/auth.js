const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(profile.id, 'signup', { role: profile.role });
    res.json({ success: true, user: profile });
  } catch (e) { await logError(e, { route: 'signup' }); res.status(500).json({ error: e.message }); }
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
