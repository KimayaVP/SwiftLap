const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');

const router = express.Router();

// NOTE: order matters — specific paths before /:swimmerId.

router.post('/meets/create', async (req, res) => {
  try {
    const { name, date, location, swimmerId } = req.body;

    const { data, error } = await supabase
      .from('meets')
      .insert({ name, date, location: location || null, created_by: swimmerId })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(swimmerId, 'meet_created', { meetId: data.id, name });
    res.json({ success: true, meet: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/meets/add-result', async (req, res) => {
  try {
    const { meetId, swimmerId, stroke, distance, minutes, seconds, place, medal } = req.body;
    const timeSeconds = parseInt(minutes) * 60 + parseInt(seconds);

    // Check if this is a PB
    const { data: existingTimes } = await supabase
      .from('meet_results')
      .select('time_seconds')
      .eq('swimmer_id', swimmerId)
      .eq('stroke', stroke)
      .eq('distance', distance);

    const { data: swimTimes } = await supabase
      .from('swim_times')
      .select('time_seconds')
      .eq('swimmer_id', swimmerId)
      .eq('stroke', stroke)
      .eq('distance', distance);

    const allTimes = [...(existingTimes || []), ...(swimTimes || [])].map(t => parseFloat(t.time_seconds));
    const isPB = allTimes.length === 0 || timeSeconds < Math.min(...allTimes);

    const { data, error } = await supabase
      .from('meet_results')
      .insert({
        meet_id: meetId,
        swimmer_id: swimmerId,
        stroke,
        distance: parseInt(distance),
        time_seconds: timeSeconds,
        place: place || null,
        medal: medal || null,
        is_pb: isPB
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Also log to swim_times so it counts toward goals
    await supabase.from('swim_times').insert({
      swimmer_id: swimmerId,
      stroke,
      distance: parseInt(distance),
      time_seconds: timeSeconds,
      date: new Date().toISOString().split('T')[0]
    });

    await trackEvent(swimmerId, 'meet_result_added', { meetId, stroke, distance, isPB });
    res.json({ success: true, result: data, isPB });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/meets/search', async (req, res) => {
  try {
    const { query } = req.query;
    const { data, error } = await supabase
      .from('meets')
      .select('*')
      .ilike('name', `%${query || ''}%`)
      .order('date', { ascending: false })
      .limit(10);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ meets: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/meets/pbs/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('meet_results')
      .select('*, meets(name, date)')
      .eq('swimmer_id', req.params.swimmerId)
      .eq('is_pb', true)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ pbs: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/meets/:meetId/results/:swimmerId', async (req, res) => {
  try {
    const { data: meet } = await supabase
      .from('meets')
      .select('*')
      .eq('id', req.params.meetId)
      .single();

    const { data: results, error } = await supabase
      .from('meet_results')
      .select('*')
      .eq('meet_id', req.params.meetId)
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ meet, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Parameterized route last
router.get('/meets/:swimmerId', async (req, res) => {
  try {
    const { data: results } = await supabase
      .from('meet_results')
      .select('meet_id')
      .eq('swimmer_id', req.params.swimmerId);

    const meetIds = [...new Set((results || []).map(r => r.meet_id))];

    if (!meetIds.length) return res.json({ meets: [] });

    const { data: meets, error } = await supabase
      .from('meets')
      .select('*')
      .in('id', meetIds)
      .order('date', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    // Get results count for each meet
    for (const meet of meets || []) {
      const { count } = await supabase
        .from('meet_results')
        .select('*', { count: 'exact', head: true })
        .eq('meet_id', meet.id)
        .eq('swimmer_id', req.params.swimmerId);
      meet.resultCount = count || 0;
    }

    res.json({ meets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
