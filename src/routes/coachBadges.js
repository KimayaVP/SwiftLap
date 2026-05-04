const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');

const router = express.Router();

// Award badge to swimmer
router.post('/coach-badges/award', async (req, res) => {
  try {
    const { coachId, swimmerId, badgeName, badgeIcon, message } = req.body;

    const { data, error } = await supabase
      .from('coach_badges')
      .insert({ coach_id: coachId, swimmer_id: swimmerId, badge_name: badgeName, badge_icon: badgeIcon, message: message || null })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(coachId, 'badge_awarded', { swimmerId, badgeName });
    res.json({ success: true, badge: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get badges awarded to a swimmer
router.get('/coach-badges/swimmer/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coach_badges')
      .select('*, coach:coach_id(name)')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ badges: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get badges awarded by a coach
router.get('/coach-badges/coach/:coachId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coach_badges')
      .select('*, swimmer:swimmer_id(name)')
      .eq('coach_id', req.params.coachId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ badges: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
