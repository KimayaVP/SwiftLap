const express = require('express');
const { supabase } = require('../db');
const { isSelf, forbidden } = require('../lib/auth');
const { createNotification } = require('../lib/notifications');
const { isConfigured } = require('../lib/apns');

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

// Register (or refresh) the caller's device push token. Upserts on token so a
// device that changes hands re-points to the current user.
router.post('/notifications/register-device', async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    const { error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: req.user.id,
        token,
        platform: platform || 'ios',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'token' });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Drop a device token (called on logout so a signed-out phone stops receiving
// the user's pushes).
router.post('/notifications/unregister-device', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('token', token)
      .eq('user_id', req.user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnostic: send a test push to the caller's OWN devices, confirming the full
// APNs pipeline end-to-end. Self-only (uses req.user.id), so it can't spam
// anyone else. Returns whether the server sees the APNs config + device count.
router.post('/notifications/test', async (req, res) => {
  try {
    const { count } = await supabase
      .from('device_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id);
    await createNotification(req.user.id, 'test', 'SwiftLap',
      'Push notifications are working! 🎉');
    res.json({ success: true, apnsConfigured: isConfigured(), devices: count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
