const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { getWeekStart, formatTime } = require('../lib/utils');
const { generatePlan } = require('../lib/plan');
const { isSelf, isCoach, coachOwnsSwimmer, canAccessSwimmer, forbidden } = require('../lib/auth');

const router = express.Router();

router.get('/training-plan/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const swimmerId = req.params.swimmerId;
    const weekStart = getWeekStart(new Date());
    const month = new Date().toISOString().slice(0, 7);
    const { data: profile } = await supabase.from('profiles').select('active_goal_id').eq('id', swimmerId).single();
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
    const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
    if (!goals?.length || !times?.length) {
      return res.json({ ready: false, missing: { goals: !goals?.length, times: !times?.length } });
    }
    const goal = profile?.active_goal_id ? goals.find(g => g.id === profile.active_goal_id) || goals[0] : goals[0];
    const feedback = feedbacks?.[0] || null;
    const relevantTimes = times.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
    const bestTime = relevantTimes.length ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
    const goalGap = bestTime ? bestTime - goal.target_seconds : 15;
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const consistencyScore = Math.min(100, Math.round((times.filter(t => t.date >= d30).length / 12) * 100));
    const { data: existingPlan } = await supabase.from('training_plans').select('*').eq('swimmer_id', swimmerId).eq('week_start', weekStart).single();
    const currentData = { goalGap, goalStroke: goal.stroke, goalDistance: goal.distance, consistency: consistencyScore, bestTime };
    if (existingPlan) {
      const old = existingPlan.generated_from || {};
      const shouldRegen = !old.goalStroke || old.goalStroke !== goal.stroke || old.goalDistance !== goal.distance || Math.abs((old.goalGap || 0) - goalGap) > 3;
      if (!shouldRegen) {
        await trackEvent(swimmerId, 'training_plan_view', { regenerated: false });
        return res.json({ ready: true, plan: existingPlan.plan, regenerated: false, weekStart });
      }
      const plan = generatePlan(goal, feedback, goalGap, consistencyScore, bestTime);
      await supabase.from('training_plans').update({ plan, generated_from: currentData }).eq('id', existingPlan.id);
      await trackEvent(swimmerId, 'training_plan_view', { regenerated: true });
      return res.json({ ready: true, plan, regenerated: true, weekStart });
    }
    const plan = generatePlan(goal, feedback, goalGap, consistencyScore, bestTime);
    await supabase.from('training_plans').insert({ swimmer_id: swimmerId, week_start: weekStart, plan, generated_from: currentData });
    await trackEvent(swimmerId, 'training_plan_view', { regenerated: true });
    res.json({ ready: true, plan, regenerated: true, weekStart });
  } catch (e) { await logError(e, { route: 'training-plan' }); res.status(500).json({ error: e.message }); }
});

router.get('/race-plan/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const month = new Date().toISOString().slice(0, 7);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', month).order('created_at', { ascending: false });
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId);
    const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId);
    if (!goals?.length || !times?.length) return res.json({ ready: false, missing: { goals: !goals?.length, times: !times?.length } });
    const g = goals[0];
    const rt = times.filter(t => t.stroke === g.stroke && t.distance === g.distance);
    const best = rt.length ? Math.min(...rt.map(t => t.time_seconds)) : null;
    const gap = best ? best - g.target_seconds : null;
    res.json({ ready: true, goal: g, performance: { bestTime: best, gap }, trainingFocus: [feedbacks[0].feedback.priority_focus, gap > 5 ? 'Volume' : 'Race pace'], racePlan: { strategy: gap > 0 ? 'Conservative' : 'Even', splits: [{ segment: 'First half', target: Math.round(g.target_seconds * 0.52) + 's' }, { segment: 'Second half', target: Math.round(g.target_seconds * 0.48) + 's' }], targetTime: formatTime(g.target_seconds) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Coach assigns a custom training routine to a swimmer
router.post('/training-routines/assign', async (req, res) => {
  try {
    const coachId = req.user.id;
    const { swimmerId, title, details } = req.body;
    if (!swimmerId || !title) {
      return res.status(400).json({ error: 'swimmerId and title are required' });
    }
    if (!isCoach(req) || !(await coachOwnsSwimmer(coachId, swimmerId))) return forbidden(res);
    const { data, error } = await supabase
      .from('coach_routines')
      .insert({ coach_id: coachId, swimmer_id: swimmerId, title, details: details || null })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(coachId, 'routine_assigned', { swimmerId, title });
    res.json({ success: true, routine: data });
  } catch (e) { await logError(e, { route: 'routine-assign' }); res.status(500).json({ error: e.message }); }
});

// Swimmer views routines assigned by their coach
router.get('/training-routines/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const { data, error } = await supabase
      .from('coach_routines')
      .select('*')
      .eq('swimmer_id', req.params.swimmerId)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });

    const coachIds = [...new Set((data || []).map(r => r.coach_id))];
    let coachMap = {};
    if (coachIds.length) {
      const { data: coaches } = await supabase.from('profiles').select('id, name').in('id', coachIds);
      coachMap = Object.fromEntries((coaches || []).map(c => [c.id, c.name]));
    }
    const routines = (data || []).map(r => ({ ...r, coachName: coachMap[r.coach_id] || 'Coach' }));
    res.json({ routines });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Coach or swimmer removes an assigned routine
router.delete('/training-routines/:id', async (req, res) => {
  try {
    const { data: routine } = await supabase.from('coach_routines').select('coach_id, swimmer_id').eq('id', req.params.id).single();
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    // The coach who assigned it, or the swimmer it's for, may remove it.
    if (!isSelf(req, routine.coach_id) && !isSelf(req, routine.swimmer_id)) return forbidden(res);
    const { error } = await supabase.from('coach_routines').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
