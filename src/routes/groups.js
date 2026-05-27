const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');
const { generateInviteCode } = require('../lib/utils');
const { computeGroupLeaderboard } = require('../lib/groupLeaderboard');
const { isSelf, inGroup, forbidden } = require('../lib/auth');

const router = express.Router();

// NOTE: order matters — leave/create/join must come before /:swimmerId.

router.post('/groups/create', async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { name } = req.body;
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
    const swimmerId = req.user.id;
    const { code } = req.body;

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
    const swimmerId = req.user.id;
    const { groupId } = req.body;

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
    if (!(await inGroup(req.user.id, req.params.groupId))) return forbidden(res);
    const leaderboard = await computeGroupLeaderboard(req.params.groupId);
    res.json({ leaderboard });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get swimmer's groups (parameterized — keep last)
router.get('/groups/:swimmerId', async (req, res) => {
  try {
    if (!isSelf(req, req.params.swimmerId)) return forbidden(res);
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
