const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');

const router = express.Router();

// NOTE: order matters — specific paths before /:coachId.

router.post('/batches/create', async (req, res) => {
  try {
    const { name, coachId } = req.body;

    const { data: batch, error } = await supabase
      .from('coach_batches')
      .insert({ name, coach_id: coachId })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(coachId, 'batch_created', { batchId: batch.id, name });
    res.json({ success: true, batch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/batches/add-swimmer', async (req, res) => {
  try {
    const { batchId, swimmerId } = req.body;

    const { error } = await supabase
      .from('batch_members')
      .insert({ batch_id: batchId, swimmer_id: swimmerId });

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Swimmer already in this batch' });
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/batches/remove-swimmer', async (req, res) => {
  try {
    const { batchId, swimmerId } = req.body;

    const { error } = await supabase
      .from('batch_members')
      .delete()
      .eq('batch_id', batchId)
      .eq('swimmer_id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Two-segment paths first
router.get('/batches/:batchId/leaderboard', async (req, res) => {
  try {
    const { data: members } = await supabase
      .from('batch_members')
      .select('swimmer_id, profiles(id, name)')
      .eq('batch_id', req.params.batchId);

    if (!members?.length) return res.json({ leaderboard: [] });

    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const leaderboard = [];

    for (const m of members) {
      const swimmerId = m.swimmer_id;
      const name = m.profiles.name;

      const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
      const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId);
      const { data: streak } = await supabase.from('streaks').select('current_streak').eq('swimmer_id', swimmerId).single();

      const recentTimes = times?.filter(t => t.date >= d30) || [];
      const sessionsThisMonth = recentTimes.length;

      let improvementPct = 0;
      if (times?.length >= 2) {
        const sorted = [...times].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        improvementPct = Math.round(((sorted[0].time_seconds - sorted[sorted.length - 1].time_seconds) / sorted[0].time_seconds) * 100);
      }

      let goalsAchieved = 0;
      for (const g of goals || []) {
        const best = times?.filter(t => t.stroke === g.stroke && t.distance === g.distance)
          .reduce((min, t) => Math.min(min, t.time_seconds), Infinity);
        if (best <= g.target_seconds) goalsAchieved++;
      }
      const goalRate = goals?.length ? Math.round((goalsAchieved / goals.length) * 100) : 0;

      const compositeScore = Math.round(
        (improvementPct * 0.4) + (goalRate * 0.3) +
        (Math.min(100, sessionsThisMonth * 10) * 0.2) +
        ((streak?.current_streak || 0) * 2 * 0.1)
      );

      leaderboard.push({ id: swimmerId, name, improvementPct, goalRate, sessionsThisMonth, streak: streak?.current_streak || 0, compositeScore });
    }

    leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
    leaderboard.forEach((s, i) => s.rank = i + 1);

    res.json({ leaderboard });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/batches/:batchId/available/:coachId', async (req, res) => {
  try {
    // Get all coach's swimmers
    const { data: swimmers } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('coach_id', req.params.coachId)
      .eq('role', 'swimmer');

    // Get swimmers already in batch
    const { data: members } = await supabase
      .from('batch_members')
      .select('swimmer_id')
      .eq('batch_id', req.params.batchId);

    const memberIds = (members || []).map(m => m.swimmer_id);
    const available = (swimmers || []).filter(s => !memberIds.includes(s.id));

    res.json({ available });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/batches/:batchId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('coach_batches')
      .delete()
      .eq('id', req.params.batchId);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Parameterized route last
router.get('/batches/:coachId', async (req, res) => {
  try {
    const { data: batches, error } = await supabase
      .from('coach_batches')
      .select('*')
      .eq('coach_id', req.params.coachId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    // Get member count for each batch
    for (const batch of batches || []) {
      const { count } = await supabase
        .from('batch_members')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batch.id);
      batch.memberCount = count || 0;
    }

    res.json({ batches });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
