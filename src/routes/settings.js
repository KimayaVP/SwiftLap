const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');
const { canAccessSwimmer, forbidden } = require('../lib/auth');

const router = express.Router();

// Update leaderboard visibility setting
router.post('/settings/leaderboard-visibility', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { showOnLeaderboard } = req.body;

    const { error } = await supabase
      .from('profiles')
      .update({ show_on_leaderboard: showOnLeaderboard })
      .eq('id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(swimmerId, 'leaderboard_visibility_changed', { showOnLeaderboard });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get swimmer settings
router.get('/settings/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const { data, error } = await supabase
      .from('profiles')
      .select('show_on_leaderboard')
      .eq('id', req.params.swimmerId)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ settings: { showOnLeaderboard: data.show_on_leaderboard ?? true } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
