const express = require('express');
const { supabase } = require('../db');
const { logError } = require('../lib/tracking');

const router = express.Router();

router.get('/leaderboard/:coachId', async (req, res) => {
  try {
    const coachId = req.params.coachId;
    const month = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`, startOfPrev = `${prevMonth}-01`;
    const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId).neq('show_on_leaderboard', false);
    if (!swimmers?.length) return res.json({ leaderboard: [], enabled: false });
    const ids = swimmers.map(s => s.id);
    const { data: allTimes } = await supabase.from('swim_times').select('*').in('swimmer_id', ids);
    const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', ids).eq('month', month);
    const lb = swimmers.map(s => {
      const st = (allTimes || []).filter(t => t.swimmer_id === s.id);
      const thisM = st.filter(t => t.date >= startOfMonth);
      const prevM = st.filter(t => t.date >= startOfPrev && t.date < startOfMonth);
      const sg = (goals || []).filter(g => g.swimmer_id === s.id);
      let impPct = 0;
      if (prevM.length && thisM.length) {
        const pAvg = prevM.reduce((a, t) => a + t.time_seconds, 0) / prevM.length;
        const tAvg = thisM.reduce((a, t) => a + t.time_seconds, 0) / thisM.length;
        impPct = ((pAvg - tAvg) / pAvg) * 100;
      }
      const cons = Math.min(100, (thisM.length / 12) * 100);
      let goalRate = 0;
      if (sg.length) {
        const done = sg.filter(g => {
          const rt = thisM.filter(t => t.stroke === g.stroke && t.distance === g.distance);
          return rt.length && Math.min(...rt.map(t => t.time_seconds)) <= g.target_seconds;
        }).length;
        goalRate = (done / sg.length) * 100;
      }
      const score = (impPct * 0.4) + (cons * 0.3) + (goalRate * 0.3);
      return { id: s.id, name: s.name, improvementPct: Math.round(impPct * 10) / 10, consistencyScore: Math.round(cons), goalCompletionRate: Math.round(goalRate), compositeScore: Math.round(score * 10) / 10 };
    });
    lb.sort((a, b) => b.compositeScore - a.compositeScore);
    const top = lb[0]?.compositeScore || 0;
    lb.forEach((s, i) => { s.rank = i + 1; s.deltaFromTop = Math.round((top - s.compositeScore) * 10) / 10; });

    // Check for #1 badge
    if (lb.length > 0 && lb[0].id) {
      const { data: existing } = await supabase.from('achievements').select('*').eq('swimmer_id', lb[0].id).eq('badge_id', 'top_rank');
      if (!existing?.length) {
        await supabase.from('achievements').insert({ swimmer_id: lb[0].id, badge_id: 'top_rank' });
      }
    }

    res.json({ leaderboard: lb, enabled: true });
  } catch (e) { await logError(e, { route: 'leaderboard' }); res.status(500).json({ error: e.message }); }
});

module.exports = router;
