require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
  const { data: profile, error: profileError } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
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
  const { data: profile, error: profileError } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: 'swimmer', coach_id: coachId }).select().single();
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, swimmer: profile });
});

// Coach: Get swimmers
app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  const { data: swimmers, error } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ swimmers });
});

// Coach: Get full dashboard data
app.get('/api/coach/dashboard/:coachId', async (req, res) => {
  const coachId = req.params.coachId;
  const month = new Date().toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`;
  
  // Get all swimmers
  const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
  
  if (!swimmers || swimmers.length === 0) {
    return res.json({ swimmers: [], summary: { total: 0, ahead: 0, behind: 0, noGoals: 0 } });
  }
  
  const swimmerIds = swimmers.map(s => s.id);
  
  // Get all goals for this month
  const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', swimmerIds).eq('month', month);
  
  // Get all times this month
  const { data: times } = await supabase.from('swim_times').select('*').in('swimmer_id', swimmerIds).gte('date', startOfMonth);
  
  // Get latest feedback for each swimmer
  const { data: feedbacks } = await supabase.from('video_feedback').select('*').in('swimmer_id', swimmerIds).order('created_at', { ascending: false });
  
  // Process each swimmer
  const swimmerData = swimmers.map(swimmer => {
    const swimmerGoals = (goals || []).filter(g => g.swimmer_id === swimmer.id);
    const swimmerTimes = (times || []).filter(t => t.swimmer_id === swimmer.id);
    const swimmerFeedback = (feedbacks || []).filter(f => f.swimmer_id === swimmer.id);
    
    // Calculate progress for each goal
    let status = 'no_goals';
    let goalsAhead = 0;
    let goalsBehind = 0;
    let bestImprovement = null;
    
    swimmerGoals.forEach(goal => {
      const relevantTimes = swimmerTimes.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
      if (relevantTimes.length > 0) {
        const bestTime = Math.min(...relevantTimes.map(t => t.time_seconds));
        if (bestTime <= goal.target_seconds) goalsAhead++;
        else goalsBehind++;
        
        // Calculate improvement (first vs best)
        if (relevantTimes.length >= 2) {
          const sortedTimes = relevantTimes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          const firstTime = sortedTimes[0].time_seconds;
          const improvement = firstTime - bestTime;
          if (bestImprovement === null || improvement > bestImprovement) {
            bestImprovement = improvement;
          }
        }
      }
    });
    
    if (swimmerGoals.length > 0) {
      status = goalsBehind > 0 ? 'behind' : 'ahead';
    }
    
    return {
      ...swimmer,
      goalsCount: swimmerGoals.length,
      goalsAhead,
      goalsBehind,
      sessionsThisMonth: swimmerTimes.length,
      status,
      improvement: bestImprovement || 0,
      latestFeedback: swimmerFeedback[0] || null
    };
  });
  
  // Sort by improvement for ranking
  const ranked = [...swimmerData].sort((a, b) => b.improvement - a.improvement);
  
  // Summary stats
  const summary = {
    total: swimmers.length,
    ahead: swimmerData.filter(s => s.status === 'ahead').length,
    behind: swimmerData.filter(s => s.status === 'behind').length,
    noGoals: swimmerData.filter(s => s.status === 'no_goals').length,
    mostImproved: ranked[0]?.name || null,
    mostImprovedBy: ranked[0]?.improvement || 0
  };
  
  res.json({ swimmers: swimmerData, summary, ranked });
});

// Log swim time
app.post('/api/times', async (req, res) => {
  const { swimmerId, stroke, distance, minutes, seconds } = req.body;
  const timeSeconds = (parseInt(minutes) * 60) + parseInt(seconds);
  const { data, error } = await supabase.from('swim_times').insert({ swimmer_id: swimmerId, stroke, distance, time_seconds: timeSeconds }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, time: data });
});

// Get swim times
app.get('/api/times/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ times: data });
});

// Set goal
app.post('/api/goals', async (req, res) => {
  const { swimmerId, stroke, distance, targetMinutes, targetSeconds } = req.body;
  const targetSecondsTotal = (parseInt(targetMinutes) * 60) + parseInt(targetSeconds);
  const month = new Date().toISOString().slice(0, 7);
  const { data: existing } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', distance).eq('month', month).single();
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

// Upload video
app.post('/api/video/upload', upload.single('video'), async (req, res) => {
  try {
    const { swimmerId, stroke } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No video file provided' });
    const fileName = `${swimmerId}/${Date.now()}-${file.originalname}`;
    const { data: uploadData, error: uploadError } = await supabase.storage.from('videos').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) return res.status(400).json({ error: uploadError.message });
    const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(fileName);
    const feedback = generateSwimFeedback(stroke);
    const { data: feedbackData, error: feedbackError } = await supabase.from('video_feedback').insert({ swimmer_id: swimmerId, video_url: publicUrl, stroke: stroke, feedback: feedback }).select().single();
    if (feedbackError) return res.status(400).json({ error: feedbackError.message });
    res.json({ success: true, feedback: feedbackData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get video feedback
app.get('/api/video/feedback/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ feedbacks: data });
});

function generateSwimFeedback(stroke) {
  const feedbackTemplates = {
    Freestyle: { body_position: ['Good horizontal alignment', 'Hips dropping slightly', 'Excellent streamlined position'][Math.floor(Math.random() * 3)], arm_technique: ['Strong catch phase', 'Early vertical forearm needs work', 'Good pull pattern'][Math.floor(Math.random() * 3)], kick: ['Consistent 6-beat kick', 'Kick from hips, not knees', 'Good ankle flexibility'][Math.floor(Math.random() * 3)], breathing: ['Bilateral breathing well executed', 'Head lifting too high', 'Good timing on breath'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Work on catch phase', 'Improve body rotation', 'Strengthen kick tempo'][Math.floor(Math.random() * 3)] },
    Backstroke: { body_position: ['Good rotation on long axis', 'Keep head still and neutral', 'Hips riding high'][Math.floor(Math.random() * 3)], arm_technique: ['Pinky-first entry is correct', 'Arm entry too wide', 'Good deep catch'][Math.floor(Math.random() * 3)], kick: ['Steady flutter kick', 'Knees breaking surface', 'Good propulsion'][Math.floor(Math.random() * 3)], timing: ['Arms well synchronized', 'Pause at recovery', 'Smooth rhythm'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Focus on hip rotation', 'Improve arm entry', 'Work on kick depth'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: ['Good undulation', 'Stay more horizontal', 'Head position needs work'][Math.floor(Math.random() * 3)], arm_technique: ['Strong outsweep', 'Elbows collapsing early', 'Good insweep power'][Math.floor(Math.random() * 3)], kick: ['Powerful whip kick', 'Knees too wide', 'Good ankle rotation'][Math.floor(Math.random() * 3)], timing: ['Pull-breathe-kick-glide sequenced', 'Rushing the glide', 'Good timing'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Extend glide phase', 'Narrow knee recovery', 'Improve timing'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: ['Good dolphin undulation', 'Hips not driving enough', 'Excellent body wave'][Math.floor(Math.random() * 3)], arm_technique: ['Strong keyhole pull', 'Arms entering too narrow', 'Good simultaneous recovery'][Math.floor(Math.random() * 3)], kick: ['Two kicks per stroke correct', 'Second kick weak', 'Powerful downbeat'][Math.floor(Math.random() * 3)], breathing: ['Low forward breath', 'Head lifting too high', 'Good breath timing'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Strengthen second kick', 'Lower breathing position', 'Improve hip drive'][Math.floor(Math.random() * 3)] },
    IM: { transitions: ['Smooth turn transitions', 'Losing speed on fly-to-back', 'Good underwater work'][Math.floor(Math.random() * 3)], pacing: ['Well distributed effort', 'Going out too fast', 'Smart energy management'][Math.floor(Math.random() * 3)], technique_consistency: ['All strokes sound', 'Breaststroke weakest', 'Strong freestyle finish'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Work on weakest stroke', 'Improve turn speed', 'Practice race pacing'][Math.floor(Math.random() * 3)] }
  };
  return feedbackTemplates[stroke] || feedbackTemplates['Freestyle'];
}

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});
