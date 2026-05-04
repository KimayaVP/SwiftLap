const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { validateTimeInput } = require('../lib/utils');
const { checkAndAwardBadges, updateStreak } = require('../lib/badges');

const router = express.Router();

router.post('/times', async (req, res) => {
  try {
    const { swimmerId, stroke, distance, minutes, seconds } = req.body;
    const v = validateTimeInput(stroke, distance, minutes, seconds);
    if (!v.valid) return res.status(400).json({ error: v.errors.join(', ') });
    const today = new Date().toISOString().split('T')[0];
    const { data: ex } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', parseInt(distance)).eq('date', today).eq('time_seconds', v.totalSeconds);
    if (ex?.length) return res.status(400).json({ error: 'Duplicate' });
    const { data, error } = await supabase.from('swim_times').insert({ swimmer_id: swimmerId, stroke, distance: parseInt(distance), time_seconds: v.totalSeconds }).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Update streak and check badges
    const streakResult = await updateStreak(swimmerId);
    const newBadges = await checkAndAwardBadges(swimmerId);

    await trackEvent(swimmerId, 'time_logged', { stroke, distance, time: v.totalSeconds });
    res.json({ success: true, time: data, streak: streakResult, newBadges });
  } catch (e) { await logError(e, { route: 'times-post' }); res.status(500).json({ error: e.message }); }
});

router.get('/times/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ times: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
