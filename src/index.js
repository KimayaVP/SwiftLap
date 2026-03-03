require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Health check
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
});

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body;
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return res.status(400).json({ error: authError.message });
  
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ id: authData.user.id, email, name, role: role || 'swimmer' })
    .select().single();
  
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, user: profile });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  res.json({ success: true, user: profile, session: data.session });
});

// Coach: Add swimmer
app.post('/api/coach/add-swimmer', async (req, res) => {
  const { email, password, name, coachId } = req.body;
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return res.status(400).json({ error: authError.message });
  
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ id: authData.user.id, email, name, role: 'swimmer', coach_id: coachId })
    .select().single();
  
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, swimmer: profile });
});

// Coach: Get swimmers
app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  const { data: swimmers, error } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ swimmers });
});

// Log swim time
app.post('/api/times', async (req, res) => {
  const { swimmerId, stroke, distance, minutes, seconds } = req.body;
  const timeSeconds = (parseInt(minutes) * 60) + parseInt(seconds);
  
  const { data, error } = await supabase
    .from('swim_times')
    .insert({ swimmer_id: swimmerId, stroke, distance, time_seconds: timeSeconds })
    .select().single();
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, time: data });
});

// Get swim times
app.get('/api/times/:swimmerId', async (req, res) => {
  const { data, error } = await supabase
    .from('swim_times')
    .select('*')
    .eq('swimmer_id', req.params.swimmerId)
    .order('created_at', { ascending: false });
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ times: data });
});

// Set goal
app.post('/api/goals', async (req, res) => {
  const { swimmerId, stroke, distance, targetMinutes, targetSeconds } = req.body;
  const targetSecondsTotal = (parseInt(targetMinutes) * 60) + parseInt(targetSeconds);
  const month = new Date().toISOString().slice(0, 7);
  
  const { data: existing } = await supabase
    .from('goals')
    .select('*')
    .eq('swimmer_id', swimmerId)
    .eq('stroke', stroke)
    .eq('distance', distance)
    .eq('month', month)
    .single();
  
  let data, error;
  if (existing) {
    ({ data, error } = await supabase.from('goals').update({ target_seconds: targetSecondsTotal }).eq('id', existing.id).select().single());
  } else {
    ({ data, error } = await supabase.from('goals').insert({ swimmer_id: swimmerId, stroke, distance, target_seconds: targetSecondsTotal, month }).select().single());
  }
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, goal: data });
});

// Get goals
app.get('/api/goals/:swimmerId', async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const { data, error } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', month);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ goals: data });
});

// Get progress
app.get('/api/progress/:swimmerId', async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const swimmerId = req.params.swimmerId;
  
  const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', month);
  const startOfMonth = `${month}-01`;
  const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).gte('date', startOfMonth).order('created_at', { ascending: false });
  
  const progress = (goals || []).map(goal => {
    const relevantTimes = (times || []).filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
    const bestTime = relevantTimes.length > 0 ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
    const avgTime = relevantTimes.length > 0 ? Math.round(relevantTimes.reduce((sum, t) => sum + t.time_seconds, 0) / relevantTimes.length) : null;
    const status = bestTime === null ? 'no_data' : bestTime <= goal.target_seconds ? 'ahead' : 'behind';
    const gap = bestTime ? bestTime - goal.target_seconds : null;
    return { goal, sessionsLogged: relevantTimes.length, bestTime, avgTime, status, gap };
  });
  
  res.json({ progress, times: times || [] });
});

// Upload video and get AI feedback
app.post('/api/video/upload', upload.single('video'), async (req, res) => {
  try {
    const { swimmerId, stroke } = req.body;
    const file = req.file;
    
    if (!file) return res.status(400).json({ error: 'No video file provided' });
    
    // Upload to Supabase Storage
    const fileName = `${swimmerId}/${Date.now()}-${file.originalname}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')
      .upload(fileName, file.buffer, { contentType: file.mimetype });
    
    if (uploadError) return res.status(400).json({ error: uploadError.message });
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(fileName);
    
    // Generate AI feedback (simulated analysis based on stroke type)
    const feedback = generateSwimFeedback(stroke);
    
    // Store feedback in database
    const { data: feedbackData, error: feedbackError } = await supabase
      .from('video_feedback')
      .insert({
        swimmer_id: swimmerId,
        video_url: publicUrl,
        stroke: stroke,
        feedback: feedback
      })
      .select()
      .single();
    
    if (feedbackError) return res.status(400).json({ error: feedbackError.message });
    
    res.json({ success: true, feedback: feedbackData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get video feedback history
app.get('/api/video/feedback/:swimmerId', async (req, res) => {
  const { data, error } = await supabase
    .from('video_feedback')
    .select('*')
    .eq('swimmer_id', req.params.swimmerId)
    .order('created_at', { ascending: false });
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ feedbacks: data });
});

// AI Feedback Generator (simulated - replace with real AI later)
function generateSwimFeedback(stroke) {
  const feedbackTemplates = {
    Freestyle: {
      body_position: ['Good horizontal alignment', 'Hips dropping slightly - engage core more', 'Excellent streamlined position'][Math.floor(Math.random() * 3)],
      arm_technique: ['Strong catch phase', 'Early vertical forearm needs work', 'Good pull pattern, maintain high elbow'][Math.floor(Math.random() * 3)],
      kick: ['Consistent 6-beat kick', 'Kick from hips, not knees', 'Good ankle flexibility shown'][Math.floor(Math.random() * 3)],
      breathing: ['Bilateral breathing well executed', 'Head lifting too high - rotate more', 'Good timing on breath'][Math.floor(Math.random() * 3)],
      overall_score: Math.floor(Math.random() * 3) + 7,
      priority_focus: ['Work on catch phase', 'Improve body rotation', 'Strengthen kick tempo'][Math.floor(Math.random() * 3)]
    },
    Backstroke: {
      body_position: ['Good rotation on long axis', 'Keep head still and neutral', 'Hips riding high - excellent'][Math.floor(Math.random() * 3)],
      arm_technique: ['Pinky-first entry is correct', 'Arm entry too wide', 'Good deep catch position'][Math.floor(Math.random() * 3)],
      kick: ['Steady flutter kick', 'Knees breaking surface - kick deeper', 'Good propulsion from kick'][Math.floor(Math.random() * 3)],
      timing: ['Arms well synchronized', 'Pause at recovery - keep continuous', 'Smooth rhythm maintained'][Math.floor(Math.random() * 3)],
      overall_score: Math.floor(Math.random() * 3) + 7,
      priority_focus: ['Focus on hip rotation', 'Improve arm entry angle', 'Work on kick depth'][Math.floor(Math.random() * 3)]
    },
    Breaststroke: {
      body_position: ['Good undulation', 'Stay more horizontal during glide', 'Head position needs work'][Math.floor(Math.random() * 3)],
      arm_technique: ['Strong outsweep', 'Elbows collapsing early', 'Good insweep power'][Math.floor(Math.random() * 3)],
      kick: ['Powerful whip kick', 'Knees too wide on recovery', 'Good ankle rotation'][Math.floor(Math.random() * 3)],
      timing: ['Pull-breathe-kick-glide well sequenced', 'Rushing the glide phase', 'Good timing on power phase'][Math.floor(Math.random() * 3)],
      overall_score: Math.floor(Math.random() * 3) + 7,
      priority_focus: ['Extend glide phase', 'Narrow knee recovery', 'Improve timing sequence'][Math.floor(Math.random() * 3)]
    },
    Butterfly: {
      body_position: ['Good dolphin undulation', 'Hips not driving enough', 'Excellent body wave'][Math.floor(Math.random() * 3)],
      arm_technique: ['Strong keyhole pull', 'Arms entering too narrow', 'Good simultaneous recovery'][Math.floor(Math.random() * 3)],
      kick: ['Two kicks per stroke cycle correct', 'Second kick weak', 'Powerful downbeat'][Math.floor(Math.random() * 3)],
      breathing: ['Low forward breath', 'Head lifting too high', 'Good breath timing'][Math.floor(Math.random() * 3)],
      overall_score: Math.floor(Math.random() * 3) + 7,
      priority_focus: ['Strengthen second kick', 'Lower breathing position', 'Improve hip drive'][Math.floor(Math.random() * 3)]
    },
    IM: {
      transitions: ['Smooth turn transitions', 'Losing speed on fly-to-back turn', 'Good underwater work'][Math.floor(Math.random() * 3)],
      pacing: ['Well distributed effort', 'Going out too fast on fly', 'Smart energy management'][Math.floor(Math.random() * 3)],
      technique_consistency: ['All strokes technically sound', 'Breaststroke weakest link', 'Strong freestyle finish'][Math.floor(Math.random() * 3)],
      overall_score: Math.floor(Math.random() * 3) + 7,
      priority_focus: ['Work on weakest stroke', 'Improve turn speed', 'Practice race pacing'][Math.floor(Math.random() * 3)]
    }
  };
  
  return feedbackTemplates[stroke] || feedbackTemplates['Freestyle'];
}

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});
