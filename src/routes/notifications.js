const express = require('express');
const { supabase } = require('../db');
const { isSelf, forbidden } = require('../lib/auth');

const router = express.Router();

// A user's own notifications (newest first) + unread count.
router.get('/notifications/:userId', async (req, res) => {
  try {
    if (!isSelf(req, req.params.userId)) return forbidden(res);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(400).json({ error: error.message });
    const unread = (data || []).filter(n => !n.read_at).length;
    res.json({ notifications: data || [], unread });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark one (body.id) or all of the caller's notifications as read.
router.post('/notifications/read', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.body;
    let q = supabase.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (id) q = q.eq('id', id);
    const { error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
