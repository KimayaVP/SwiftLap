const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');
const { generateInviteCode } = require('../lib/utils');

const router = express.Router();

// NOTE: order matters — leave/create/join must come before /:swimmerId.

router.post('/groups/create', async (req, res) => {
  try {
    const { name, swimmerId } = req.body;
    const inviteCode = generateInviteCode();

    const { data: group, error } = await supabase
      .from('swimmer_groups')
      .insert({ name, invite_code: inviteCode, created_by: swimmerId })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Add creator as member
    await supabase
      .from('group_members')
      .insert({ group_id: group.id, swimmer_id: swimmerId });

    await trackEvent(swimmerId, 'group_created', { groupId: group.id, name });
    res.json({ success: true, group });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/groups/join', async (req, res) => {
  try {
    const { code, swimmerId } = req.body;

    const { data: group, error: findError } = await supabase
      .from('swimmer_groups')
      .select('*')
      .eq('invite_code', code.toUpperCase())
      .single();

    if (findError || !group) return res.status(404).json({ error: 'Invalid invite code' });

    // Check if already member
    const { data: existing } = await supabase
      .from('group_members')
      .select('*')
      .eq('group_id', group.id)
      .eq('swimmer_id', swimmerId)
      .single();

    if (existing) return res.status(400).json({ error: 'Already a member of this group' });

    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, swimmer_id: swimmerId });

    if (error) return res.status(400).json({ error: error.message });

    await trackEvent(swimmerId, 'group_joined', { groupId: group.id });
    res.json({ success: true, group });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/groups/leave', async (req, res) => {
  try {
    const { groupId, swimmerId } = req.body;

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('swimmer_id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get group leaderboard. Two-segment path so doesn't conflict with /:swimmerId.
router.get('/groups/:groupId/leaderboard', async (req, res) => {
  try {
    // Get all members
    const { data: members } = await supabase
      .from('group_members')
      .select('swimmer_id, profiles(id, name)')
      .eq('group_id', req.params.groupId);

    if (!members?.length) return res.json({ leaderboard: [] });

    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const leaderboard = [];

    for (const m of members) {
      const swimmerId = m.swimmer_id;
      const name = m.profiles.name;

      // Get times
      const { data: times } = await supabase
        .from('swim_times')
        .select('*')
        .eq('swimmer_id', swimmerId);

      // Get goals
      const { data: goals } = await supabase
        .from('goals')
        .select('*')
        .eq('swimmer_id', swimmerId);

      // Get streak
      const { data: streak } = await supabase
        .from('streaks')
        .select('current_streak')
        .eq('swimmer_id', swimmerId)
        .single();

      // Calculate stats
      const recentTimes = times?.filter(t => t.date >= d30) || [];
      const sessionsThisMonth = recentTimes.length;

      // Calculate improvement
      let improvementPct = 0;
      if (times?.length >= 2) {
        const sorted = [...times].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const first = sorted[0].time_seconds;
        const last = sorted[sorted.length - 1].time_seconds;
        improvementPct = Math.round(((first - last) / first) * 100);
      }

      // Goal completion
      let goalsAchieved = 0;
      for (const g of goals || []) {
        const best = times?.filter(t => t.stroke === g.stroke && t.distance === g.distance)
          .reduce((min, t) => Math.min(min, t.time_seconds), Infinity);
        if (best <= g.target_seconds) goalsAchieved++;
      }
      const goalRate = goals?.length ? Math.round((goalsAchieved / goals.length) * 100) : 0;

      // Composite score
      const compositeScore = Math.round(
        (improvementPct * 0.4) +
        (goalRate * 0.3) +
        (Math.min(100, sessionsThisMonth * 10) * 0.2) +
        ((streak?.current_streak || 0) * 2 * 0.1)
      );

      leaderboard.push({
        id: swimmerId,
        name,
        improvementPct,
        goalRate,
        sessionsThisMonth,
        streak: streak?.current_streak || 0,
        compositeScore
      });
    }

    // Sort by composite score
    leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
    leaderboard.forEach((s, i) => s.rank = i + 1);

    res.json({ leaderboard });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get swimmer's groups (parameterized — keep last)
router.get('/groups/:swimmerId', async (req, res) => {
  try {
    const { data: memberships, error } = await supabase
      .from('group_members')
      .select('group_id, swimmer_groups(id, name, invite_code, created_by)')
      .eq('swimmer_id', req.params.swimmerId);

    if (error) return res.status(400).json({ error: error.message });

    const groups = memberships.map(m => ({
      ...m.swimmer_groups,
      isOwner: m.swimmer_groups.created_by === req.params.swimmerId
    }));

    res.json({ groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
