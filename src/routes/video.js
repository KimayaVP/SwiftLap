const express = require('express');
const multer = require('multer');
const { supabase } = require('../db');
const { logError, trackEvent } = require('../lib/tracking');
const { checkAndAwardBadges } = require('../lib/badges');
const { genFeedback } = require('../lib/feedback');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/video/upload', upload.single('video'), async (req, res) => {
  try {
    const { swimmerId, stroke } = req.body;
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
    await trackEvent(swimmerId, 'video_uploaded', { stroke });
    res.json({ success: true, feedback: data, newBadges });
  } catch (e) { await logError(e, { route: 'video-upload' }); res.status(500).json({ error: e.message }); }
});

router.get('/video/feedback/:swimmerId', async (req, res) => {
  try {
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
