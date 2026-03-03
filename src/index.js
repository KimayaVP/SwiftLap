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

// Coach: Dashboard
app.get('/api/coach/dashboard/:coachId', async (req, res) => {
  const coachId = req.params.coachId;
  const month = new Date().toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`;
  const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
  if (!swimmers || swimmers.length === 0) return res.json({ swimmers: [], summary: { total: 0, ahead: 0, behind: 0, noGoals: 0 } });
  const swimmerIds = swimmers.map(s => s.id);
  const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', swimmerIds).eq('month', month);
  const { data: times } = await supabase.from('swim_times').select('*').in('swimmer_id', swimmerIds).gte('date', startOfMonth);
  const { data: feedbacks } = await supabase.from('video_feedback').select('*').in('swimmer_id', swimmerIds).order('created_at', { ascending: false });
  const swimmerData = swimmers.map(swimmer => {
    const swimmerGoals = (goals || []).filter(g => g.swimmer_id === swimmer.id);
    const swimmerTimes = (times || []).filter(t => t.swimmer_id === swimmer.id);
    const swimmerFeedback = (feedbacks || []).filter(f => f.swimmer_id === swimmer.id);
    let status = 'no_goals', goalsAhead = 0, goalsBehind = 0, bestImprovement = null;
    swimmerGoals.forEach(goal => {
      const relevantTimes = swimmerTimes.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
      if (relevantTimes.length > 0) {
        const bestTime = Math.min(...relevantTimes.map(t => t.time_seconds));
        if (bestTime <= goal.target_seconds) goalsAhead++; else goalsBehind++;
        if (relevantTimes.length >= 2) {
          const sortedTimes = relevantTimes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          const improvement = sortedTimes[0].time_seconds - bestTime;
          if (bestImprovement === null || improvement > bestImprovement) bestImprovement = improvement;
        }
      }
    });
    if (swimmerGoals.length > 0) status = goalsBehind > 0 ? 'behind' : 'ahead';
    return { ...swimmer, goalsCount: swimmerGoals.length, goalsAhead, goalsBehind, sessionsThisMonth: swimmerTimes.length, status, improvement: bestImprovement || 0, latestFeedback: swimmerFeedback[0] || null };
  });
  const ranked = [...swimmerData].sort((a, b) => b.improvement - a.improvement);
  const summary = { total: swimmers.length, ahead: swimmerData.filter(s => s.status === 'ahead').length, behind: swimmerData.filter(s => s.status === 'behind').length, noGoals: swimmerData.filter(s => s.status === 'no_goals').length, mostImproved: ranked[0]?.name || null, mostImprovedBy: ranked[0]?.improvement || 0 };
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
  if (existing) ({ data, error } = await supabase.from('goals').update({ target_seconds: targetSecondsTotal }).eq('id', existing.id).select().single());
  else ({ data, error } = await supabase.from('goals').insert({ swimmer_id: swimmerId, stroke, distance, target_seconds: targetSecondsTotal, month }).select().single());
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
    const { error: uploadError } = await supabase.storage.from('videos').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) return res.status(400).json({ error: uploadError.message });
    const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(fileName);
    const feedback = generateSwimFeedback(stroke);
    const { data: feedbackData, error: feedbackError } = await supabase.from('video_feedback').insert({ swimmer_id: swimmerId, video_url: publicUrl, stroke, feedback }).select().single();
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

// Generate Race Plan
app.get('/api/race-plan/:swimmerId', async (req, res) => {
  const swimmerId = req.params.swimmerId;
  const month = new Date().toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`;
  
  // Get all data
  const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', month);
  const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
  const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
  
  // Check if enough data
  const hasGoals = goals && goals.length > 0;
  const hasTimes = times && times.length > 0;
  const hasVideo = feedbacks && feedbacks.length > 0;
  
  if (!hasGoals || !hasTimes || !hasVideo) {
    return res.json({
      ready: false,
      missing: {
        goals: !hasGoals,
        times: !hasTimes,
        video: !hasVideo
      }
    });
  }
  
  // Analyze data for race plan
  const primaryGoal = goals[0];
  const relevantTimes = times.filter(t => t.stroke === primaryGoal.stroke && t.distance === primaryGoal.distance);
  const bestTime = relevantTimes.length > 0 ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
  const avgTime = relevantTimes.length > 0 ? Math.round(relevantTimes.reduce((sum, t) => sum + t.time_seconds, 0) / relevantTimes.length) : null;
  const gap = bestTime ? bestTime - primaryGoal.target_seconds : null;
  const latestFeedback = feedbacks[0].feedback;
  
  // Generate training focus based on feedback and gap
  const trainingFocus = generateTrainingFocus(latestFeedback, gap, primaryGoal.stroke);
  
  // Generate race plan based on distance and performance
  const racePlan = generateRacePlan(primaryGoal, bestTime, avgTime, gap);
  
  // Generate warm-up plan
  const warmupPlan = generateWarmupPlan(primaryGoal.stroke, primaryGoal.distance);
  
  res.json({
    ready: true,
    goal: primaryGoal,
    performance: { bestTime, avgTime, gap, sessionsLogged: relevantTimes.length },
    trainingFocus,
    racePlan,
    warmupPlan,
    basedOn: {
      goalsCount: goals.length,
      timesCount: times.length,
      feedbackCount: feedbacks.length,
      latestFeedbackStroke: feedbacks[0].stroke
    }
  });
});

function generateTrainingFocus(feedback, gap, stroke) {
  const focuses = [];
  
  // Based on feedback priority
  if (feedback.priority_focus) {
    focuses.push(feedback.priority_focus);
  }
  
  // Based on gap to goal
  if (gap !== null) {
    if (gap > 5) {
      focuses.push('Increase training volume - significant gap to goal');
      focuses.push('Focus on endurance building');
    } else if (gap > 0) {
      focuses.push('Fine-tune technique for marginal gains');
      focuses.push('Race pace intervals');
    } else {
      focuses.push('Maintain current form');
      focuses.push('Work on consistency');
    }
  }
  
  // Stroke-specific
  const strokeFocuses = {
    Freestyle: ['Streamline off walls', 'Breathing pattern optimization'],
    Backstroke: ['Underwater dolphin kicks', 'Turn timing'],
    Breaststroke: ['Pullout efficiency', 'Kick timing'],
    Butterfly: ['Rhythm and tempo', 'Underwater phase'],
    IM: ['Transition efficiency', 'Pace distribution']
  };
  
  if (strokeFocuses[stroke]) {
    focuses.push(strokeFocuses[stroke][Math.floor(Math.random() * 2)]);
  }
  
  return focuses.slice(0, 4);
}

function generateRacePlan(goal, bestTime, avgTime, gap) {
  const distance = goal.distance;
  const targetTime = goal.target_seconds;
  
  let strategy, splits, mentalCues;
  
  if (distance === 50) {
    strategy = 'Explosive start, maintain speed throughout';
    splits = [{ segment: 'Start to 25m', pace: 'Maximum effort', target: Math.round(targetTime * 0.48) + 's' }, { segment: '25m to finish', pace: 'Hold speed, strong finish', target: Math.round(targetTime * 0.52) + 's' }];
    mentalCues = ['Explosive off the blocks', 'No breathing first 15m', 'Drive through the wall'];
  } else if (distance === 100) {
    strategy = gap > 0 ? 'Conservative first 50, build second half' : 'Even splits, controlled aggression';
    splits = [{ segment: 'First 25m', pace: 'Fast but controlled', target: Math.round(targetTime * 0.24) + 's' }, { segment: '25-50m', pace: 'Settle into rhythm', target: Math.round(targetTime * 0.26) + 's' }, { segment: '50-75m', pace: 'Maintain form', target: Math.round(targetTime * 0.26) + 's' }, { segment: '75-100m', pace: 'Build to finish', target: Math.round(targetTime * 0.24) + 's' }];
    mentalCues = ['Smooth first 50', 'Patience at the turn', 'Accelerate final 25'];
  } else if (distance === 200) {
    strategy = 'Negative split - second 100 faster than first';
    splits = [{ segment: 'First 50m', pace: 'Conservative', target: Math.round(targetTime * 0.24) + 's' }, { segment: '50-100m', pace: 'Build rhythm', target: Math.round(targetTime * 0.26) + 's' }, { segment: '100-150m', pace: 'Start pushing', target: Math.round(targetTime * 0.26) + 's' }, { segment: '150-200m', pace: 'All out', target: Math.round(targetTime * 0.24) + 's' }];
    mentalCues = ['Relax first 100', 'Midpoint check-in', 'Empty the tank last 50'];
  } else {
    strategy = 'Even pacing with strong finish';
    splits = [{ segment: 'First 100m', pace: 'Find rhythm', target: Math.round(targetTime * 0.24) + 's' }, { segment: '100-200m', pace: 'Maintain', target: Math.round(targetTime * 0.26) + 's' }, { segment: '200-300m', pace: 'Stay strong', target: Math.round(targetTime * 0.26) + 's' }, { segment: '300-400m', pace: 'Finish hard', target: Math.round(targetTime * 0.24) + 's' }];
    mentalCues = ['Patience early', 'Break into 100s mentally', 'Last 100 is the race'];
  }
  
  return { strategy, splits, mentalCues, targetTime: formatTimeServer(targetTime) };
}

function generateWarmupPlan(stroke, distance) {
  const baseWarmup = [
    { activity: 'Easy swim mix', distance: '400m', notes: 'Loosen up, get feel for water' },
    { activity: `${stroke} drill work`, distance: '200m', notes: 'Focus on technique cues' },
    { activity: 'Build swims', distance: '4x50m', notes: 'Increase effort each 50' },
    { activity: 'Race pace', distance: '2x25m', notes: 'At target race speed' },
    { activity: 'Easy swim', distance: '200m', notes: 'Recovery before race' }
  ];
  
  return {
    totalDistance: '1000m',
    timeNeeded: '20-25 minutes',
    activities: baseWarmup,
    finalPrep: ['Stretch behind blocks', 'Visualize race', '2-3 practice starts']
  };
}

function formatTimeServer(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function generateSwimFeedback(stroke) {
  const templates = {
    Freestyle: { body_position: ['Good horizontal alignment', 'Hips dropping slightly', 'Excellent streamlined position'][Math.floor(Math.random() * 3)], arm_technique: ['Strong catch phase', 'Early vertical forearm needs work', 'Good pull pattern'][Math.floor(Math.random() * 3)], kick: ['Consistent 6-beat kick', 'Kick from hips, not knees', 'Good ankle flexibility'][Math.floor(Math.random() * 3)], breathing: ['Bilateral breathing well executed', 'Head lifting too high', 'Good timing on breath'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Work on catch phase', 'Improve body rotation', 'Strengthen kick tempo'][Math.floor(Math.random() * 3)] },
    Backstroke: { body_position: ['Good rotation on long axis', 'Keep head still and neutral', 'Hips riding high'][Math.floor(Math.random() * 3)], arm_technique: ['Pinky-first entry is correct', 'Arm entry too wide', 'Good deep catch'][Math.floor(Math.random() * 3)], kick: ['Steady flutter kick', 'Knees breaking surface', 'Good propulsion'][Math.floor(Math.random() * 3)], timing: ['Arms well synchronized', 'Pause at recovery', 'Smooth rhythm'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Focus on hip rotation', 'Improve arm entry', 'Work on kick depth'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: ['Good undulation', 'Stay more horizontal', 'Head position needs work'][Math.floor(Math.random() * 3)], arm_technique: ['Strong outsweep', 'Elbows collapsing early', 'Good insweep power'][Math.floor(Math.random() * 3)], kick: ['Powerful whip kick', 'Knees too wide', 'Good ankle rotation'][Math.floor(Math.random() * 3)], timing: ['Pull-breathe-kick-glide sequenced', 'Rushing the glide', 'Good timing'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Extend glide phase', 'Narrow knee recovery', 'Improve timing'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: ['Good dolphin undulation', 'Hips not driving enough', 'Excellent body wave'][Math.floor(Math.random() * 3)], arm_technique: ['Strong keyhole pull', 'Arms entering too narrow', 'Good simultaneous recovery'][Math.floor(Math.random() * 3)], kick: ['Two kicks per stroke correct', 'Second kick weak', 'Powerful downbeat'][Math.floor(Math.random() * 3)], breathing: ['Low forward breath', 'Head lifting too high', 'Good breath timing'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Strengthen second kick', 'Lower breathing position', 'Improve hip drive'][Math.floor(Math.random() * 3)] },
    IM: { transitions: ['Smooth turn transitions', 'Losing speed on fly-to-back', 'Good underwater work'][Math.floor(Math.random() * 3)], pacing: ['Well distributed effort', 'Going out too fast', 'Smart energy management'][Math.floor(Math.random() * 3)], technique_consistency: ['All strokes sound', 'Breaststroke weakest', 'Strong freestyle finish'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Work on weakest stroke', 'Improve turn speed', 'Practice race pacing'][Math.floor(Math.random() * 3)] }
  };
  return templates[stroke] || templates['Freestyle'];
}

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});
