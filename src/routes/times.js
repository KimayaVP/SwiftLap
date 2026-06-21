const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { validateTimeInput } = require('../lib/utils');
const { checkAndAwardBadges, updateStreak } = require('../lib/badges');
const { notifyGroupRankChanges } = require('../lib/groupLeaderboard');
const { canAccessSwimmer, forbidden } = require('../lib/auth');

const router = express.Router();

router.post('/times', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { stroke, distance, minutes, seconds } = req.body;
    const v = validateTimeInput(stroke, distance, minutes, seconds);
    if (!v.valid) return res.status(400).json({ error: v.errors.join(', ') });
    const today = new Date().toISOString().split('T')[0];
    const { data: ex } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', parseInt(distance)).eq('date', today).eq('time_seconds', v.totalSeconds);
    if (ex?.length) return res.status(400).json({ error: 'Duplicate' });
    const { data, error } = await supabase.from('swim_times').insert({ swimmer_id: swimmerId, stroke, distance: parseInt(distance), time_seconds: v.totalSeconds, source: 'manual' }).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Update streak and check badges
    const streakResult = await updateStreak(swimmerId);
    const newBadges = await checkAndAwardBadges(swimmerId);

    await trackEvent(swimmerId, 'time_logged', { stroke, distance, time: v.totalSeconds });
    await notifyGroupRankChanges(swimmerId);  // overtake notifications in friend groups
    res.json({ success: true, time: data, streak: streakResult, newBadges });
  } catch (e) { await logError(e, { route: 'times-post' }); res.status(500).json({ error: e.message }); }
});

router.get('/times/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ times: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete one of the caller's own logged times (e.g. an accidental entry). Scoped
// to swimmer_id = req.user.id so a swimmer can only delete their own rows.
router.delete('/times/:id', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { error } = await supabase.from('swim_times').delete().eq('id', req.params.id).eq('swimmer_id', swimmerId);
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(swimmerId, 'time_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (e) { await logError(e, { route: 'times-delete' }); res.status(500).json({ error: e.message }); }
});

module.exports = router;
