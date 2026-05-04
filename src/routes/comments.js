const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');

const router = express.Router();

// Add comment or reaction
router.post('/comments/add', async (req, res) => {
  try {
    const { coachId, swimmerId, timeId, comment, reaction } = req.body;

    const { data, error } = await supabase
      .from('coach_comments')
      .insert({ coach_id: coachId, swimmer_id: swimmerId, time_id: timeId || null, comment: comment || null, reaction: reaction || null })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(coachId, 'comment_added', { swimmerId, hasComment: !!comment, hasReaction: !!reaction });
    res.json({ success: true, comment: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get comments for a swimmer (swimmer view)
router.get('/comments/swimmer/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coach_comments')
      .select('*, coach:coach_id(name), time:time_id(stroke, distance, time_seconds, date)')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ comments: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get recent times for a swimmer (coach view for commenting)
router.get('/comments/swimmer-times/:swimmerId', async (req, res) => {
  try {
    const { data: times, error } = await supabase
      .from('swim_times')
      .select('*')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return res.status(400).json({ error: error.message });

    // Get existing comments for these times
    const timeIds = times.map(t => t.id);
    const { data: comments } = await supabase
      .from('coach_comments')
      .select('*')
      .in('time_id', timeIds);

    const timesWithComments = times.map(t => ({
      ...t,
      comments: (comments || []).filter(c => c.time_id === t.id)
    }));

    res.json({ times: timesWithComments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
