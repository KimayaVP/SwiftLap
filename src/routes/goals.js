const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { getWeekStart } = require('../lib/utils');
const { checkAndAwardBadges } = require('../lib/badges');

const router = express.Router();

// NOTE: more-specific routes must come before /goals/:swimmerId so they
// don't get swallowed by the wildcard. Express matches routes in
// registration order within a router.

router.post('/goals', async (req, res) => {
  try {
    const { swimmerId, stroke, distance, targetMinutes, targetSeconds } = req.body;
    const target = (parseInt(targetMinutes) * 60) + parseInt(targetSeconds);
    const month = new Date().toISOString().slice(0, 7);
    const { data: ex } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', distance).eq('month', month).single();
    let data, error;
    if (ex) ({ data, error } = await supabase.from('goals').update({ target_seconds: target }).eq('id', ex.id).select().single());
    else ({ data, error } = await supabase.from('goals').insert({ swimmer_id: swimmerId, stroke, distance, target_seconds: target, month }).select().single());
    if (error) return res.status(400).json({ error: error.message });

    const newBadges = await checkAndAwardBadges(swimmerId);
    await trackEvent(swimmerId, 'goal_set', { stroke, distance, target });
    res.json({ success: true, goal: data, newBadges });
  } catch (e) { await logError(e, { route: 'goals-post' }); res.status(500).json({ error: e.message }); }
});

router.post('/goals/set-active', async (req, res) => {
  try {
    const { swimmerId, goalId } = req.body;

    const { error } = await supabase
      .from('profiles')
      .update({ active_goal_id: goalId })
      .eq('id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    // Clear training plan so it regenerates with new goal
    const weekStart = getWeekStart(new Date());
    await supabase
      .from('training_plans')
      .delete()
      .eq('swimmer_id', swimmerId)
      .eq('week_start', weekStart);

    await trackEvent(swimmerId, 'active_goal_changed', { goalId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/goals/all/:swimmerId', async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_goal_id')
      .eq('id', req.params.swimmerId)
      .single();

    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    // Mark active goal
    const goals = (data || []).map(g => ({
      ...g,
      isActive: g.id === profile?.active_goal_id
    }));

    // If no active goal set but goals exist, first one is default active
    if (goals.length > 0 && !goals.some(g => g.isActive)) {
      goals[0].isActive = true;
    }

    res.json({ goals, activeGoalId: profile?.active_goal_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/goals/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', new Date().toISOString().slice(0, 7)).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ goals: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/progress/:swimmerId', async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', month).order('created_at', { ascending: false });
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).gte('date', `${month}-01`);
    const progress = (goals || []).map(g => {
      const rt = (times || []).filter(t => t.stroke === g.stroke && t.distance === g.distance);
      const best = rt.length ? Math.min(...rt.map(t => t.time_seconds)) : null;
      const status = best === null ? 'no_data' : best <= g.target_seconds ? 'ahead' : 'behind';
      return { goal: g, sessionsLogged: rt.length, bestTime: best, status, gap: best ? best - g.target_seconds : null };
    });
    res.json({ progress, times: times || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
