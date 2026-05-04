const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');

const router = express.Router();

router.post('/coach/add-swimmer', async (req, res) => {
  try {
    const { email, password, name, coachId } = req.body;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: 'swimmer', coach_id: coachId }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(coachId, 'add_swimmer', { swimmerId: profile.id });
    res.json({ success: true, swimmer: profile });
  } catch (e) { await logError(e, { route: 'add-swimmer' }); res.status(500).json({ error: e.message }); }
});

router.get('/coach/swimmers/:coachId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ swimmers: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/coach/dashboard/:coachId', async (req, res) => {
  try {
    const coachId = req.params.coachId;
    const month = new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;
    const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
    if (!swimmers?.length) return res.json({ swimmers: [], summary: { total: 0, ahead: 0, behind: 0, noGoals: 0 } });
    const ids = swimmers.map(s => s.id);
    const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', ids).eq('month', month);
    const { data: times } = await supabase.from('swim_times').select('*').in('swimmer_id', ids).gte('date', startOfMonth);
    const { data: plans } = await supabase.from('training_plans').select('*').in('swimmer_id', ids).order('created_at', { ascending: false });
    const { data: streaks } = await supabase.from('streaks').select('*').in('swimmer_id', ids);
    const { data: achievements } = await supabase.from('achievements').select('*').in('swimmer_id', ids);

    const swimmerData = swimmers.map(s => {
      const sg = (goals || []).filter(g => g.swimmer_id === s.id);
      const st = (times || []).filter(t => t.swimmer_id === s.id);
      const sp = (plans || []).find(p => p.swimmer_id === s.id);
      const ss = (streaks || []).find(x => x.swimmer_id === s.id);
      const sa = (achievements || []).filter(a => a.swimmer_id === s.id);
      let status = 'no_goals', goalsAhead = 0, goalsBehind = 0;
      sg.forEach(g => {
        const rt = st.filter(t => t.stroke === g.stroke && t.distance === g.distance);
        if (rt.length) {
          const best = Math.min(...rt.map(t => t.time_seconds));
          if (best <= g.target_seconds) goalsAhead++; else goalsBehind++;
        }
      });
      if (sg.length) status = goalsBehind > 0 ? 'behind' : 'ahead';
      return { ...s, goalsCount: sg.length, goalsAhead, goalsBehind, sessionsThisMonth: st.length, status, currentPlan: sp || null, streak: ss?.current_streak || 0, badges: sa.length };
    });
    const summary = { total: swimmers.length, ahead: swimmerData.filter(s => s.status === 'ahead').length, behind: swimmerData.filter(s => s.status === 'behind').length, noGoals: swimmerData.filter(s => s.status === 'no_goals').length };
    await trackEvent(coachId, 'dashboard_view', {});
    res.json({ swimmers: swimmerData, summary });
  } catch (e) { await logError(e, { route: 'coach-dashboard' }); res.status(500).json({ error: e.message }); }
});

module.exports = router;
