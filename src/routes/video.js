const express = require('express');
const multer = require('multer');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { checkAndAwardBadges } = require('../lib/badges');
const { genFeedback } = require('../lib/feedback');
const { createNotification } = require('../lib/notifications');
const { requireCron, isSelf, isCoach, coachOwnsSwimmer, canAccessSwimmer, forbidden } = require('../lib/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/video/upload', upload.single('video'), async (req, res) => {
  try {
    const swimmerId = req.user.id;
    const { stroke } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No video' });
    const fileName = `${swimmerId}/${Date.now()}-${req.file.originalname}`;
    const { error: upErr } = await supabase.storage.from('videos').upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
    if (upErr) return res.status(400).json({ error: upErr.message });
    // Store the storage PATH (not a public URL). The bucket should be private;
    // we hand out short-lived signed URLs on read instead.
    const feedback = genFeedback(stroke);
    const { data, error } = await supabase.from('video_feedback').insert({ swimmer_id: swimmerId, video_url: fileName, stroke, feedback }).select().single();
    if (error) return res.status(400).json({ error: error.message });

    const newBadges = await checkAndAwardBadges(swimmerId);

    // Notify the swimmer's coach there's a new clip awaiting review.
    const { data: prof } = await supabase.from('profiles').select('coach_id, name').eq('id', swimmerId).single();
    if (prof?.coach_id) {
      await createNotification(prof.coach_id, 'video_review',
        '🎥 New video to review',
        `${prof.name || 'A swimmer'} uploaded a ${stroke || ''} clip.`.replace(/\s+/g, ' ').trim(),
        { swimmerId, videoId: data.id });
    }

    await trackEvent(swimmerId, 'video_uploaded', { stroke });
    res.json({ success: true, feedback: data, newBadges });
  } catch (e) { await logError(e, { route: 'video-upload' }); res.status(500).json({ error: e.message }); }
});

// Cost control: delete uploaded video files older than 14 days. Keeps the
// feedback text/record — only the heavy file is removed from storage.
// Wired to a daily GitHub Actions cron.
router.post('/video/cleanup', requireCron, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: old } = await supabase
      .from('video_feedback')
      .select('id, video_url')
      .lt('created_at', cutoff)
      .not('video_url', 'is', null);
    const expired = (old || []).filter(r => r.video_url && !r.video_url.startsWith('http'));
    let removed = 0;
    if (expired.length) {
      const { error } = await supabase.storage.from('videos').remove(expired.map(r => r.video_url));
      if (!error) {
        removed = expired.length;
        await supabase.from('video_feedback').update({ video_url: null }).in('id', expired.map(r => r.id));
      }
    }
    res.json({ success: true, removed });
  } catch (e) { await logError(e, { route: 'video-cleanup' }); res.status(500).json({ error: e.message }); }
});

// Coach leaves written feedback on a swimmer's uploaded video (Option A review).
router.post('/video/coach-feedback', async (req, res) => {
  try {
    const coachId = req.user.id;
    const { videoId, feedback } = req.body;
    if (!videoId || !feedback) {
      return res.status(400).json({ error: 'videoId and feedback are required' });
    }
    // The video must belong to a swimmer this coach owns.
    const { data: vid } = await supabase.from('video_feedback').select('swimmer_id').eq('id', videoId).single();
    if (!vid) return res.status(404).json({ error: 'Video not found' });
    if (!isCoach(req) || !(await coachOwnsSwimmer(coachId, vid.swimmer_id))) return forbidden(res);
    const { data, error } = await supabase
      .from('video_feedback')
      .update({ coach_feedback: feedback, coach_feedback_at: new Date().toISOString(), coach_id: coachId })
      .eq('id', videoId)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(coachId, 'video_coach_feedback', { videoId });
    res.json({ success: true, feedback: data });
  } catch (e) { await logError(e, { route: 'video-coach-feedback' }); res.status(500).json({ error: e.message }); }
});

// Coach review queue: clips from this coach's swimmers that still need feedback.
router.get('/video/pending/:coachId', async (req, res) => {
  try {
    if (!isSelf(req, req.params.coachId) || !isCoach(req)) return forbidden(res);
    const { data: swimmers } = await supabase.from('profiles').select('id, name').eq('coach_id', req.params.coachId);
    const ids = (swimmers || []).map(s => s.id);
    if (!ids.length) return res.json({ pending: [] });
    const { data: vids } = await supabase
      .from('video_feedback')
      .select('id, swimmer_id, stroke, created_at')
      .in('swimmer_id', ids)
      .is('coach_feedback', null)
      .order('created_at', { ascending: false });
    const nameMap = Object.fromEntries((swimmers || []).map(s => [s.id, s.name]));
    const pending = (vids || []).map(v => ({
      id: v.id,
      swimmerId: v.swimmer_id,
      swimmerName: nameMap[v.swimmer_id] || 'Swimmer',
      stroke: v.stroke,
      createdAt: v.created_at,
    }));
    res.json({ pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/video/feedback/:swimmerId', async (req, res) => {
  try {
    if (!(await canAccessSwimmer(req, req.params.swimmerId))) return forbidden(res);
    const { data, error } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });

    // Replace stored paths with short-lived signed URLs (1h). Legacy rows that
    // still hold a full public URL (start with http) are passed through as-is.
    const feedbacks = data || [];
    for (const f of feedbacks) {
      if (f.video_url && !f.video_url.startsWith('http')) {
        const { data: signed } = await supabase.storage.from('videos').createSignedUrl(f.video_url, 3600);
        f.video_url = signed?.signedUrl || null;
      }
    }
    res.json({ feedbacks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
