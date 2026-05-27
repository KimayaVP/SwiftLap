const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');
const { notifyGroupRankChanges } = require('../lib/groupLeaderboard');
const { isSelf, isCoach, coachOwnsSwimmer, canAccessSwimmer, forbidden } = require('../lib/auth');

const router = express.Router();

// Parse a minutes/seconds pair into total seconds. Returns null when BOTH parts
// are empty (i.e. no time was entered — e.g. an upcoming event with no expected
// time, or skipping the expected time on an event).
function toSeconds(min, sec) {
  const hasMin = min !== undefined && min !== null && `${min}` !== '';
  const hasSec = sec !== undefined && sec !== null && `${sec}` !== '';
  if (!hasMin && !hasSec) return null;
  return (parseInt(min || 0) || 0) * 60 + (parseFloat(sec || 0) || 0);
}

// Is `timeSeconds` a personal best for this stroke/distance? Considers both
// logged meet results and swim_times, ignoring rows with no actual time.
async function computeIsPB(swimmerId, stroke, distance, timeSeconds) {
  const { data: mr } = await supabase
    .from('meet_results').select('time_seconds')
    .eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', distance)
    .not('time_seconds', 'is', null);
  const { data: st } = await supabase
    .from('swim_times').select('time_seconds')
    .eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', distance);
  const all = [...(mr || []), ...(st || [])]
    .map(t => parseFloat(t.time_seconds)).filter(n => !isNaN(n));
  return all.length === 0 || timeSeconds < Math.min(...all);
}

// NOTE: order matters — specific paths before /:swimmerId.

// Create a meet with one or more events. Each event carries an optional
// expected time (upcoming meets) and/or an actual time (past meets). When an
// actual time is given at creation, it's also logged to swim_times + PB-checked.
router.post('/meets/create', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { name, date, location, events } = req.body;

    const { data: meet, error } = await supabase
      .from('meets')
      .insert({ name, date, location: location || null, created_by: swimmerId })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    const evs = Array.isArray(events) ? events : [];
    const inserted = [];
    let loggedAny = false;
    for (const ev of evs) {
      const stroke = ev.stroke;
      const distance = parseInt(ev.distance);
      if (!stroke || !distance) continue;
      const expectedSeconds = toSeconds(ev.expectedMinutes, ev.expectedSeconds);
      const actualSeconds = toSeconds(ev.minutes, ev.seconds);
      const hasActual = actualSeconds != null;
      const isPB = hasActual ? await computeIsPB(swimmerId, stroke, distance, actualSeconds) : false;

      const { data: row } = await supabase
        .from('meet_results')
        .insert({
          meet_id: meet.id,
          swimmer_id: swimmerId,
          stroke,
          distance,
          expected_seconds: expectedSeconds,
          time_seconds: hasActual ? actualSeconds : null,
          place: ev.place || null,
          medal: ev.medal || null,
          is_pb: isPB,
          result_logged_at: hasActual ? new Date().toISOString() : null,
        })
        .select()
        .single();
      if (row) inserted.push(row);

      // If the actual time was entered now (a past meet), log it to swim_times
      // so it counts toward Recent Times + goals.
      if (hasActual) {
        loggedAny = true;
        await supabase.from('swim_times').insert({
          swimmer_id: swimmerId, stroke, distance,
          time_seconds: actualSeconds,
          date: date || new Date().toISOString().split('T')[0],
          source: 'race',
        });
      }
    }

    if (loggedAny) await notifyGroupRankChanges(swimmerId);
    await trackEvent(swimmerId, 'meet_created', { meetId: meet.id, name, eventCount: inserted.length });
    res.json({ success: true, meet, events: inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Log (fill in) the actual time for an existing event — used after an upcoming
// meet is over. Updates the event in place, PB-checks, and logs to swim_times.
router.post('/meets/log-result', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { resultId, minutes, seconds, place, medal } = req.body;
    const timeSeconds = toSeconds(minutes, seconds);
    if (timeSeconds == null) return res.status(400).json({ error: 'A time is required' });

    const { data: ev } = await supabase
      .from('meet_results').select('*, meets(date)').eq('id', resultId).single();
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (!isSelf(req, ev.swimmer_id)) return forbidden(res);

    const isPB = await computeIsPB(swimmerId, ev.stroke, ev.distance, timeSeconds);

    const { data, error } = await supabase
      .from('meet_results')
      .update({
        time_seconds: timeSeconds,
        place: place || ev.place || null,
        medal: medal || ev.medal || null,
        is_pb: isPB,
        result_logged_at: new Date().toISOString(),
      })
      .eq('id', resultId)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('swim_times').insert({
      swimmer_id: swimmerId, stroke: ev.stroke, distance: ev.distance,
      time_seconds: timeSeconds,
      date: ev.meets?.date || new Date().toISOString().split('T')[0],
      source: 'race',
    });

    await notifyGroupRankChanges(swimmerId);
    await trackEvent(swimmerId, 'meet_result_logged', { meetId: ev.meet_id, isPB });
    res.json({ success: true, result: data, isPB });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add a brand-new event result (with a time) to an existing meet.
router.post('/meets/add-result', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { meetId, stroke, distance, minutes, seconds, place, medal } = req.body;
    const timeSeconds = toSeconds(minutes, seconds);
    if (timeSeconds == null) return res.status(400).json({ error: 'A time is required' });
    const dist = parseInt(distance);

    const isPB = await computeIsPB(swimmerId, stroke, dist, timeSeconds);

    // Use the meet's date for the swim_times entry when available.
    const { data: meet } = await supabase.from('meets').select('date').eq('id', meetId).single();

    const { data, error } = await supabase
      .from('meet_results')
      .insert({
        meet_id: meetId,
        swimmer_id: swimmerId,
        stroke,
        distance: dist,
        time_seconds: timeSeconds,
        place: place || null,
        medal: medal || null,
        is_pb: isPB,
        result_logged_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Also log to swim_times so it counts toward goals + Recent Times.
    await supabase.from('swim_times').insert({
      swimmer_id: swimmerId,
      stroke,
      distance: dist,
      time_seconds: timeSeconds,
      date: meet?.date || new Date().toISOString().split('T')[0],
      source: 'race'
    });

    await notifyGroupRankChanges(swimmerId);
    await trackEvent(swimmerId, 'meet_result_added', { meetId, stroke, distance: dist, isPB });
    res.json({ success: true, result: data, isPB });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Coach recommends a meet/race to one or more of their swimmers
router.post('/meets/recommend', async (req, res) => {
  try {
    const coachId = req.user.id;
    const { swimmerId, swimmerIds, meetName, meetDate, note } = req.body;
    const ids = Array.isArray(swimmerIds) ? swimmerIds.filter(Boolean) : (swimmerId ? [swimmerId] : []);
    if (!ids.length || !meetName) {
      return res.status(400).json({ error: 'at least one swimmer and meetName are required' });
    }
    if (!isCoach(req)) return forbidden(res);
    // Coach may only recommend to swimmers they own.
    const owned = await Promise.all(ids.map(id => coachOwnsSwimmer(coachId, id)));
    if (owned.some(ok => !ok)) return forbidden(res);
    const rows = ids.map(id => ({
      coach_id: coachId,
      swimmer_id: id,
      meet_name: meetName,
      meet_date: meetDate || null,
      note: note || null
    }));
    const { data, error } = await supabase
      .from('meet_recommendations')
      .insert(rows)
      .select();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(coachId, 'meet_recommended', { swimmerCount: ids.length, meetName });
    res.json({ success: true, recommendations: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Swimmer views meets recommended to them
router.get('/meets/recommendations/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const { data, error } = await supabase
      .from('meet_recommendations')
      .select('*')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });

    // Attach coach names in one lookup
    const coachIds = [...new Set((data || []).map(r => r.coach_id))];
    let coachMap = {};
    if (coachIds.length) {
      const { data: coaches } = await supabase.from('profiles').select('id, name').in('id', coachIds);
      coachMap = Object.fromEntries((coaches || []).map(c => [c.id, c.name]));
    }
    const recommendations = (data || []).map(r => ({ ...r, coachName: coachMap[r.coach_id] || 'Coach' }));
    res.json({ recommendations });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Swimmer accepts/declines a recommendation
router.post('/meets/recommendation/respond', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { recommendationId, status } = req.body;
    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'status must be accepted or declined' });
    }
    // Only respond to a recommendation addressed to you.
    const { data: rec } = await supabase.from('meet_recommendations').select('swimmer_id').eq('id', recommendationId).single();
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
    if (!isSelf(req, rec.swimmer_id)) return forbidden(res);
    const { data, error } = await supabase
      .from('meet_recommendations')
      .update({ status })
      .eq('id', recommendationId)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    // Accepting creates an actual meet the swimmer can log results against
    let meet = null;
    if (status === 'accepted') {
      const { data: m } = await supabase
        .from('meets')
        .insert({ name: data.meet_name, date: data.meet_date, location: data.location || null, created_by: swimmerId || data.swimmer_id })
        .select()
        .single();
      meet = m;
    }
    res.json({ success: true, recommendation: data, meet });
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
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
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
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
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

// Parameterized route last. Lists ALL of a swimmer's meets — upcoming and over —
// with a derived status (upcoming = date today-or-future) and event counts.
router.get('/meets/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const swimmerId = req.params.swimmerId;

    // Meets the swimmer has events in, plus meets they created (may have none yet).
    const { data: results } = await supabase
      .from('meet_results')
      .select('meet_id, time_seconds')
      .eq('swimmer_id', swimmerId);
    const { data: created } = await supabase
      .from('meets')
      .select('id')
      .eq('created_by', swimmerId);

    const meetIds = [...new Set([
      ...(results || []).map(r => r.meet_id),
      ...(created || []).map(m => m.id),
    ])];
    if (!meetIds.length) return res.json({ meets: [] });

    const { data: meets, error } = await supabase
      .from('meets')
      .select('*')
      .in('id', meetIds)
      .order('date', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const today = new Date().toISOString().split('T')[0];
    for (const meet of meets || []) {
      const meetEvents = (results || []).filter(r => r.meet_id === meet.id);
      meet.eventCount = meetEvents.length;
      // events still awaiting an actual time
      meet.pendingCount = meetEvents.filter(r => r.time_seconds == null).length;
      meet.resultCount = meetEvents.filter(r => r.time_seconds != null).length; // back-compat
      meet.status = (meet.date && meet.date >= today) ? 'upcoming' : 'over';
    }

    res.json({ meets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
