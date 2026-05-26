const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');
const { isSelf, canAccessSwimmer, forbidden, signWatchToken, verifyWatchToken } = require('../lib/auth');

const router = express.Router();

// Receive workout from Apple Watch. PUBLIC: the watch has no user session, so it
// proves linkage via the watch_linked_at check below rather than a Bearer token.
router.post('/watch/workout', async (req, res) => {
  try {
    const {
      duration, distance, laps, strokeCount,
      avgHeartRate, calories, lapTimes, lapStrokes,
      fatigueLevel, poolLength, date, source
    } = req.body;

    // Authenticate the device via its signed token; derive the swimmer from it
    // (never trust a client-supplied id).
    const swimmerId = verifyWatchToken(req.headers['x-watch-token'] || req.body.watchToken);
    if (!swimmerId) {
      return res.status(401).json({ error: 'Watch not authenticated. Open SwiftLap and enter a new 6-digit code to re-link.' });
    }

    // Reject syncs from a watch that has been unlinked from this account.
    // Re-linking (via a fresh 6-digit code) sets watch_linked_at again.
    const { data: linkProfile } = await supabase
      .from('profiles')
      .select('watch_linked_at')
      .eq('id', swimmerId)
      .single();
    if (!linkProfile?.watch_linked_at) {
      return res.status(403).json({ error: 'Watch not linked. Open SwiftLap and enter a new 6-digit code to re-link.' });
    }

    // Auto-clear demo rows on first real workout
    await Promise.all([
      supabase.from('watch_workouts').delete().eq('swimmer_id', swimmerId).eq('source', 'demo'),
      supabase.from('goals').delete().eq('swimmer_id', swimmerId).eq('source', 'demo'),
      supabase.from('swim_times').delete().eq('swimmer_id', swimmerId).eq('source', 'demo'),
    ]);

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
        date: date?.split('T')[0] || new Date().toISOString().split('T')[0],
        source: 'apple_watch'
      });
    }

    await trackEvent(swimmerId, 'watch_workout_synced', { laps, distance, source });
    res.json({ success: true, workout });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a watch workout
router.delete('/watch/workout/:id', async (req, res) => {
  try {
    const { data: workout } = await supabase
      .from('watch_workouts')
      .select('swimmer_id')
      .eq('id', req.params.id)
      .single();
    if (!workout) return res.status(404).json({ error: 'Workout not found' });
    if (!isSelf(req, workout.swimmer_id)) return forbidden(res);

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
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
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
    const swimmerId = req.user.id;
    const { watchId } = req.body;

    const { error } = await supabase
      .from('profiles')
      .update({ watch_id: watchId, watch_linked_at: new Date().toISOString() })
      .eq('id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(swimmerId, 'watch_linked', { watchId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unlink watch from swimmer account
router.post('/watch/unlink', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { error } = await supabase
      .from('profiles')
      .update({ watch_id: null, watch_linked_at: null })
      .eq('id', swimmerId);
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(swimmerId, 'watch_unlinked', {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Watch link status for a swimmer
router.get('/watch/status/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const { data: profile } = await supabase
      .from('profiles')
      .select('watch_linked_at')
      .eq('id', req.params.swimmerId)
      .single();
    const { count } = await supabase
      .from('watch_workouts')
      .select('*', { count: 'exact', head: true })
      .eq('swimmer_id', req.params.swimmerId);
    res.json({ linked: !!profile?.watch_linked_at, linkedAt: profile?.watch_linked_at || null, workoutCount: count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate link code for watch pairing
router.post('/watch/generate-code', async (req, res) => {
  try {
    const swimmerId = req.user.id;

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

    // Hand the device a signed token to authenticate future workout syncs.
    res.json({ swimmerId: data.swimmer_id, watchToken: signWatchToken(data.swimmer_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
