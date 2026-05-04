const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');

const router = express.Router();

// Receive workout from Apple Watch
router.post('/watch/workout', async (req, res) => {
  try {
    const {
      swimmerId, duration, distance, laps, strokeCount,
      avgHeartRate, calories, lapTimes, lapStrokes,
      fatigueLevel, poolLength, date, source
    } = req.body;

    // Save workout to database
    const { data: workout, error } = await supabase
      .from('watch_workouts')
      .insert({
        swimmer_id: swimmerId,
        duration,
        distance,
        laps,
        stroke_count: strokeCount,
        avg_heart_rate: avgHeartRate,
        calories,
        lap_times: lapTimes,
        lap_strokes: lapStrokes,
        fatigue_level: fatigueLevel,
        pool_length: poolLength,
        workout_date: date,
        source: source || 'apple_watch'
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Also log the best lap time to swim_times
    if (lapTimes && lapTimes.length > 0) {
      const bestLapTime = Math.min(...lapTimes);
      await supabase.from('swim_times').insert({
        swimmer_id: swimmerId,
        stroke: 'Freestyle', // Default, can be updated
        distance: poolLength,
        time_seconds: bestLapTime,
        date: date?.split('T')[0] || new Date().toISOString().split('T')[0]
      });
    }

    await trackEvent(swimmerId, 'watch_workout_synced', { laps, distance, source });
    res.json({ success: true, workout });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a watch workout
router.delete('/watch/workout/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('watch_workouts')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get watch workouts for a swimmer
router.get('/watch/workouts/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('watch_workouts')
      .select('*')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ workouts: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Link watch to swimmer account
router.post('/watch/link', async (req, res) => {
  try {
    const { swimmerId, watchId } = req.body;

    const { error } = await supabase
      .from('profiles')
      .update({ watch_id: watchId, watch_linked_at: new Date().toISOString() })
      .eq('id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(swimmerId, 'watch_linked', { watchId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate link code for watch pairing
router.post('/watch/generate-code', async (req, res) => {
  try {
    const { swimmerId } = req.body;

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store code with 10-minute expiry
    const { error } = await supabase
      .from('watch_link_codes')
      .insert({
        swimmer_id: swimmerId,
        code: code,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Verify link code from watch
router.post('/watch/verify-code', async (req, res) => {
  try {
    const { code } = req.body;

    const { data, error } = await supabase
      .from('watch_link_codes')
      .select('swimmer_id, expires_at')
      .eq('code', code)
      .single();

    if (error || !data) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (new Date(data.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code expired' });
    }

    // Delete used code
    await supabase.from('watch_link_codes').delete().eq('code', code);

    // Mark watch as linked
    await supabase
      .from('profiles')
      .update({ watch_linked_at: new Date().toISOString() })
      .eq('id', data.swimmer_id);

    res.json({ swimmerId: data.swimmer_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
