const express = require('express');
const { supabase } = require('../db');
const { logError } = require('../lib/tracking');
const { BADGES, checkChallengeProgress } = require('../lib/badges');

const router = express.Router();

router.get('/achievements/:swimmerId', async (req, res) => {
  try {
    const swimmerId = req.params.swimmerId;
    const { data: achievements } = await supabase.from('achievements').select('*').eq('swimmer_id', swimmerId).order('unlocked_at', { ascending: false });
    const { data: streak } = await supabase.from('streaks').select('*').eq('swimmer_id', swimmerId).single();
    const challenge = await checkChallengeProgress(swimmerId);

    const earnedBadges = (achievements || []).map(a => ({ ...BADGES[a.badge_id], unlocked_at: a.unlocked_at }));
    const allBadges = Object.values(BADGES).map(b => ({ ...b, earned: earnedBadges.some(e => e.id === b.id) }));

    res.json({
      earned: earnedBadges,
      all: allBadges,
      streak: streak || { current_streak: 0, longest_streak: 0 },
      challenge
    });
  } catch (e) { await logError(e, { route: 'achievements' }); res.status(500).json({ error: e.message }); }
});

module.exports = router;
