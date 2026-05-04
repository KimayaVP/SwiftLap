const express = require('express');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');

const router = express.Router();

router.get('/insights/:swimmerId', async (req, res) => {
  try {
    const swimmerId = req.params.swimmerId;
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const d60 = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', new Date().toISOString().slice(0, 7)).order('created_at', { ascending: false });
    const t = times || [];
    const last30 = t.filter(x => x.date >= d30);
    const prev30 = t.filter(x => x.date >= d60 && x.date < d30);
    let paceTrend = { direction: 'stable', description: 'Keep training' };
    if (last30.length >= 3 && prev30.length >= 1) {
      const rAvg = last30.reduce((a, x) => a + x.time_seconds, 0) / last30.length;
      const pAvg = prev30.reduce((a, x) => a + x.time_seconds, 0) / prev30.length;
      const ch = pAvg - rAvg;
      if (ch > 2) paceTrend = { direction: 'improving', description: `Improved ${Math.round(ch)}s` };
      else if (ch < -2) paceTrend = { direction: 'declining', description: `Slowed ${Math.abs(Math.round(ch))}s` };
    }
    const cons = Math.min(100, Math.round((last30.length / 12) * 100));
    const consDesc = cons >= 80 ? 'Excellent' : cons >= 50 ? 'Good' : 'Inconsistent';
    let goalInsight = null;
    if (goals?.length) {
      const g = goals[0];
      const rt = last30.filter(x => x.stroke === g.stroke && x.distance === g.distance);
      if (rt.length) {
        const best = Math.min(...rt.map(x => x.time_seconds));
        const gap = best - g.target_seconds;
        if (gap <= 0) goalInsight = { status: 'achieved', message: 'Goal achieved!' };
        else if (gap <= 3) goalInsight = { status: 'close', message: `${gap}s away!` };
        else goalInsight = { status: 'working', message: `${gap}s to go` };
      }
    }
    let fatigueSignal = null;
    if (last30.length >= 5) {
      const l5 = last30.slice(-5);
      const fAvg = l5.slice(0, 3).reduce((a, x) => a + x.time_seconds, 0) / 3;
      const lAvg = l5.slice(-2).reduce((a, x) => a + x.time_seconds, 0) / 2;
      if (lAvg > fAvg + 3) fatigueSignal = { detected: true, recommendation: 'Consider recovery' };
    }
    const factors = [];
    if (paceTrend.direction === 'improving') factors.push({ impact: 'positive', desc: 'Improving pace' });
    else if (paceTrend.direction === 'declining') factors.push({ impact: 'negative', desc: 'Declining pace' });
    if (cons >= 70) factors.push({ impact: 'positive', desc: 'Good consistency' });
    else factors.push({ impact: 'negative', desc: 'Low consistency' });
    await trackEvent(swimmerId, 'insights_view', {});
    res.json({ totalSessions: t.length, last30DaySessions: last30.length, paceTrend, consistencyScore: cons, consistencyDesc: consDesc, goalInsight, fatigueSignal, rankingInsight: { mainFactor: factors.find(f => f.impact === 'negative')?.desc || factors[0]?.desc || 'Keep going!', factors } });
  } catch (e) { await logError(e, { route: 'insights' }); res.status(500).json({ error: e.message }); }
});

module.exports = router;
