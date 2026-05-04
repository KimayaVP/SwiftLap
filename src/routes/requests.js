const express = require('express');
const { supabase } = require('../db');
const { trackEvent } = require('../lib/tracking');

const router = express.Router();

// Search for coaches (for swimmers to find and request)
router.get('/coaches/search', async (req, res) => {
  try {
    const { query } = req.query;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email')
      .eq('role', 'coach')
      .ilike('name', `%${query || ''}%`)
      .limit(10);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ coaches: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Swimmer sends request to coach
router.post('/requests/send', async (req, res) => {
  try {
    const { fromId, toId, type } = req.body;

    // Check if request already exists
    const { data: existing } = await supabase
      .from('coach_requests')
      .select('*')
      .eq('from_id', fromId)
      .eq('to_id', toId)
      .eq('status', 'pending')
      .single();

    if (existing) return res.status(400).json({ error: 'Request already pending' });

    const { data, error } = await supabase
      .from('coach_requests')
      .insert({ from_id: fromId, to_id: toId, type })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(fromId, 'request_sent', { toId, type });
    res.json({ success: true, request: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get pending requests FOR a user (requests they need to respond to)
router.get('/requests/incoming/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coach_requests')
      .select('*, from:from_id(id, name, email, role)')
      .eq('to_id', req.params.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ requests: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get pending requests FROM a user (requests they sent)
router.get('/requests/outgoing/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coach_requests')
      .select('*, to:to_id(id, name, email, role)')
      .eq('from_id', req.params.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ requests: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accept or reject a request
router.post('/requests/respond', async (req, res) => {
  try {
    const { requestId, action } = req.body; // action: 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Get the request
    const { data: request, error: fetchError } = await supabase
      .from('coach_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) return res.status(404).json({ error: 'Request not found' });

    // Update request status
    const { error: updateError } = await supabase
      .from('coach_requests')
      .update({ status: action === 'accept' ? 'accepted' : 'rejected', updated_at: new Date().toISOString() })
      .eq('id', requestId);

    if (updateError) return res.status(400).json({ error: updateError.message });

    // If accepted, link swimmer to coach
    if (action === 'accept') {
      const swimmerId = request.type === 'swimmer_to_coach' ? request.from_id : request.to_id;
      const coachId = request.type === 'swimmer_to_coach' ? request.to_id : request.from_id;

      const { error: linkError } = await supabase
        .from('profiles')
        .update({ coach_id: coachId })
        .eq('id', swimmerId);

      if (linkError) return res.status(400).json({ error: linkError.message });

      await trackEvent(request.to_id, 'request_accepted', { requestId, type: request.type });
    } else {
      await trackEvent(request.to_id, 'request_rejected', { requestId, type: request.type });
    }

    res.json({ success: true, action });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Coach invites swimmer by email
router.post('/requests/invite', async (req, res) => {
  try {
    const { coachId, swimmerEmail } = req.body;

    // Find swimmer by email
    const { data: swimmer, error: findError } = await supabase
      .from('profiles')
      .select('id, name, email, role, coach_id')
      .eq('email', swimmerEmail)
      .single();

    if (findError || !swimmer) return res.status(404).json({ error: 'Swimmer not found' });
    if (swimmer.role !== 'swimmer') return res.status(400).json({ error: 'User is not a swimmer' });
    if (swimmer.coach_id) return res.status(400).json({ error: 'Swimmer already has a coach' });

    // Check if invite already exists
    const { data: existing } = await supabase
      .from('coach_requests')
      .select('*')
      .eq('from_id', coachId)
      .eq('to_id', swimmer.id)
      .eq('status', 'pending')
      .single();

    if (existing) return res.status(400).json({ error: 'Invite already pending' });

    // Create invite
    const { data, error } = await supabase
      .from('coach_requests')
      .insert({ from_id: coachId, to_id: swimmer.id, type: 'coach_to_swimmer' })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(coachId, 'invite_sent', { swimmerId: swimmer.id });
    res.json({ success: true, request: data, swimmer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unlink swimmer from coach
router.post('/requests/unlink', async (req, res) => {
  try {
    const { swimmerId } = req.body;

    const { error } = await supabase
      .from('profiles')
      .update({ coach_id: null })
      .eq('id', swimmerId);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
