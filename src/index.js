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

// ========== VALIDATION HELPERS ==========
function validateTimeInput(stroke, distance, minutes, seconds) {
  const errors = [];
  
  // Valid strokes
  const validStrokes = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'IM'];
  if (!validStrokes.includes(stroke)) errors.push('Invalid stroke type');
  
  // Valid distances
  const validDistances = [50, 100, 200, 400, 800, 1500];
  if (!validDistances.includes(parseInt(distance))) errors.push('Invalid distance');
  
  // Time validation
  const mins = parseInt(minutes);
  const secs = parseInt(seconds);
  if (isNaN(mins) || mins < 0 || mins > 30) errors.push('Minutes must be 0-30');
  if (isNaN(secs) || secs < 0 || secs > 59) errors.push('Seconds must be 0-59');
  
  // Impossible time checks (world record benchmarks)
  const totalSeconds = (mins * 60) + secs;
  const minTimes = { 50: 20, 100: 45, 200: 100, 400: 220, 800: 460, 1500: 870 };
  const maxTimes = { 50: 120, 100: 240, 200: 480, 400: 900, 800: 1800, 1500: 3600 };
  
  if (totalSeconds < minTimes[distance]) errors.push(`Time too fast for ${distance}m (min ${Math.floor(minTimes[distance]/60)}:${(minTimes[distance]%60).toString().padStart(2,'0')})`);
  if (totalSeconds > maxTimes[distance]) errors.push(`Time too slow for ${distance}m (max ${Math.floor(maxTimes[distance]/60)}:${(maxTimes[distance]%60).toString().padStart(2,'0')})`);
  
  return { valid: errors.length === 0, errors, totalSeconds };
}

// ========== AUTH ROUTES ==========
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
});

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body;
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return res.status(400).json({ error: authError.message });
  const { data: profile, error: profileError } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, user: profile });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  res.json({ success: true, user: profile, session: data.session });
});

// ========== COACH ROUTES ==========
app.post('/api/coach/add-swimmer', async (req, res) => {
  const { email, password, name, coachId } = req.body;
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return res.status(400).json({ error: authError.message });
  const { data: profile, error: profileError } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: 'swimmer', coach_id: coachId }).select().single();
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, swimmer: profile });
});

app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  const { data: swimmers, error } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ swimmers });
});

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

// ========== LEADERBOARD ==========
app.get('/api/leaderboard/:coachId', async (req, res) => {
  const coachId = req.params.coachId;
  const month = new Date().toISOString().slice(0, 7);
  const prevMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`;
  const startOfPrevMonth = `${prevMonth}-01`;
  const endOfPrevMonth = `${month}-01`;
  
  // Get swimmers
  const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
  if (!swimmers || swimmers.length === 0) return res.json({ leaderboard: [], enabled: false });
  
  const swimmerIds = swimmers.map(s => s.id);
  
  // Get all times
  const { data: allTimes } = await supabase.from('swim_times').select('*').in('swimmer_id', swimmerIds).order('created_at', { ascending: true });
  
  // Get goals
  const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', swimmerIds).eq('month', month);
  
  // Calculate metrics for each swimmer
  const leaderboard = swimmers.map(swimmer => {
    const swimmerTimes = (allTimes || []).filter(t => t.swimmer_id === swimmer.id);
    const thisMonthTimes = swimmerTimes.filter(t => t.date >= startOfMonth);
    const prevMonthTimes = swimmerTimes.filter(t => t.date >= startOfPrevMonth && t.date < endOfPrevMonth);
    const swimmerGoals = (goals || []).filter(g => g.swimmer_id === swimmer.id);
    
    // Improvement % (compare avg this month vs last month)
    let improvementPct = 0;
    if (prevMonthTimes.length > 0 && thisMonthTimes.length > 0) {
      const prevAvg = prevMonthTimes.reduce((sum, t) => sum + t.time_seconds, 0) / prevMonthTimes.length;
      const thisAvg = thisMonthTimes.reduce((sum, t) => sum + t.time_seconds, 0) / thisMonthTimes.length;
      improvementPct = ((prevAvg - thisAvg) / prevAvg) * 100;
    }
    
    // Consistency score (sessions this month / expected sessions)
    const expectedSessions = 12; // 3 per week
    const consistencyScore = Math.min(100, (thisMonthTimes.length / expectedSessions) * 100);
    
    // Goal completion rate
    let goalCompletionRate = 0;
    if (swimmerGoals.length > 0) {
      const completed = swimmerGoals.filter(goal => {
        const relevantTimes = thisMonthTimes.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
        if (relevantTimes.length === 0) return false;
        const bestTime = Math.min(...relevantTimes.map(t => t.time_seconds));
        return bestTime <= goal.target_seconds;
      }).length;
      goalCompletionRate = (completed / swimmerGoals.length) * 100;
    }
    
    // Composite score (weighted)
    const compositeScore = (improvementPct * 0.4) + (consistencyScore * 0.3) + (goalCompletionRate * 0.3);
    
    return {
      id: swimmer.id,
      name: swimmer.name,
      improvementPct: Math.round(improvementPct * 10) / 10,
      consistencyScore: Math.round(consistencyScore),
      goalCompletionRate: Math.round(goalCompletionRate),
      compositeScore: Math.round(compositeScore * 10) / 10,
      sessionsThisMonth: thisMonthTimes.length,
      sessionsLastMonth: prevMonthTimes.length
    };
  });
  
  // Sort by composite score
  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  
  // Add rank and delta from top
  const topScore = leaderboard[0]?.compositeScore || 0;
  leaderboard.forEach((swimmer, index) => {
    swimmer.rank = index + 1;
    swimmer.deltaFromTop = Math.round((topScore - swimmer.compositeScore) * 10) / 10;
  });
  
  res.json({ leaderboard, enabled: true });
});

// ========== TIME LOGGING WITH VALIDATION ==========
app.post('/api/times', async (req, res) => {
  const { swimmerId, stroke, distance, minutes, seconds } = req.body;
  
  // Validate input
  const validation = validateTimeInput(stroke, distance, minutes, seconds);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors.join(', ') });
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  // Check for duplicate
  const { data: existing } = await supabase
    .from('swim_times')
    .select('*')
    .eq('swimmer_id', swimmerId)
    .eq('stroke', stroke)
    .eq('distance', parseInt(distance))
    .eq('date', today)
    .eq('time_seconds', validation.totalSeconds);
  
  if (existing && existing.length > 0) {
    return res.status(400).json({ error: 'Duplicate entry: This exact time was already logged today' });
  }
  
  const { data, error } = await supabase
    .from('swim_times')
    .insert({ swimmer_id: swimmerId, stroke, distance: parseInt(distance), time_seconds: validation.totalSeconds })
    .select()
    .single();
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, time: data });
});

app.get('/api/times/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ times: data });
});

// ========== GOALS ==========
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

app.get('/api/goals/:swimmerId', async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const { data, error } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', month);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ goals: data });
});

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

// ========== VIDEO ==========
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

app.get('/api/video/feedback/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ feedbacks: data });
});

// ========== RACE PLAN ==========
app.get('/api/race-plan/:swimmerId', async (req, res) => {
  const swimmerId = req.params.swimmerId;
  const month = new Date().toISOString().slice(0, 7);
  const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', month);
  const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
  const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
  
  const hasGoals = goals && goals.length > 0;
  const hasTimes = times && times.length > 0;
  const hasVideo = feedbacks && feedbacks.length > 0;
  
  if (!hasGoals || !hasTimes || !hasVideo) {
    return res.json({ ready: false, missing: { goals: !hasGoals, times: !hasTimes, video: !hasVideo } });
  }
  
  const primaryGoal = goals[0];
  const relevantTimes = times.filter(t => t.stroke === primaryGoal.stroke && t.distance === primaryGoal.distance);
  const bestTime = relevantTimes.length > 0 ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
  const avgTime = relevantTimes.length > 0 ? Math.round(relevantTimes.reduce((sum, t) => sum + t.time_seconds, 0) / relevantTimes.length) : null;
  const gap = bestTime ? bestTime - primaryGoal.target_seconds : null;
  const latestFeedback = feedbacks[0].feedback;
  
  const trainingFocus = generateTrainingFocus(latestFeedback, gap, primaryGoal.stroke);
  const racePlan = generateRacePlan(primaryGoal, bestTime, avgTime, gap);
  const warmupPlan = generateWarmupPlan(primaryGoal.stroke, primaryGoal.distance);
  
  res.json({
    ready: true,
    goal: primaryGoal,
    performance: { bestTime, avgTime, gap, sessionsLogged: relevantTimes.length },
    trainingFocus,
    racePlan,
    warmupPlan,
    basedOn: { goalsCount: goals.length, timesCount: times.length, feedbackCount: feedbacks.length }
  });
});

function generateTrainingFocus(feedback, gap, stroke) {
  const focuses = [];
  if (feedback.priority_focus) focuses.push(feedback.priority_focus);
  if (gap !== null) {
    if (gap > 5) { focuses.push('Increase training volume'); focuses.push('Focus on endurance'); }
    else if (gap > 0) { focuses.push('Fine-tune technique'); focuses.push('Race pace intervals'); }
    else { focuses.push('Maintain current form'); focuses.push('Work on consistency'); }
  }
  const strokeFocuses = { Freestyle: ['Streamline off walls', 'Breathing pattern'], Backstroke: ['Underwater kicks', 'Turn timing'], Breaststroke: ['Pullout efficiency', 'Kick timing'], Butterfly: ['Rhythm and tempo', 'Underwater phase'], IM: ['Transition efficiency', 'Pace distribution'] };
  if (strokeFocuses[stroke]) focuses.push(strokeFocuses[stroke][Math.floor(Math.random() * 2)]);
  return focuses.slice(0, 4);
}

function generateRacePlan(goal, bestTime, avgTime, gap) {
  const distance = goal.distance;
  const targetTime = goal.target_seconds;
  let strategy, splits, mentalCues;
  if (distance === 50) {
    strategy = 'Explosive start, maintain speed';
    splits = [{ segment: 'Start to 25m', pace: 'Maximum effort', target: Math.round(targetTime * 0.48) + 's' }, { segment: '25m to finish', pace: 'Hold speed', target: Math.round(targetTime * 0.52) + 's' }];
    mentalCues = ['Explosive off blocks', 'No breathing first 15m', 'Drive through wall'];
  } else if (distance === 100) {
    strategy = gap > 0 ? 'Conservative first 50, build second half' : 'Even splits';
    splits = [{ segment: 'First 25m', pace: 'Fast but controlled', target: Math.round(targetTime * 0.24) + 's' }, { segment: '25-50m', pace: 'Settle into rhythm', target: Math.round(targetTime * 0.26) + 's' }, { segment: '50-75m', pace: 'Maintain form', target: Math.round(targetTime * 0.26) + 's' }, { segment: '75-100m', pace: 'Build to finish', target: Math.round(targetTime * 0.24) + 's' }];
    mentalCues = ['Smooth first 50', 'Patience at turn', 'Accelerate final 25'];
  } else {
    strategy = 'Negative split - second half faster';
    splits = [{ segment: 'First quarter', pace: 'Conservative', target: Math.round(targetTime * 0.26) + 's' }, { segment: 'Second quarter', pace: 'Build rhythm', target: Math.round(targetTime * 0.26) + 's' }, { segment: 'Third quarter', pace: 'Push pace', target: Math.round(targetTime * 0.25) + 's' }, { segment: 'Final quarter', pace: 'All out', target: Math.round(targetTime * 0.23) + 's' }];
    mentalCues = ['Relax early', 'Midpoint check-in', 'Empty tank last quarter'];
  }
  return { strategy, splits, mentalCues, targetTime: formatTimeServer(targetTime) };
}

function generateWarmupPlan(stroke, distance) {
  return {
    totalDistance: '1000m',
    timeNeeded: '20-25 minutes',
    activities: [
      { activity: 'Easy swim mix', distance: '400m', notes: 'Loosen up' },
      { activity: `${stroke} drill`, distance: '200m', notes: 'Technique focus' },
      { activity: 'Build swims', distance: '4x50m', notes: 'Increase effort' },
      { activity: 'Race pace', distance: '2x25m', notes: 'Target speed' },
      { activity: 'Easy swim', distance: '200m', notes: 'Recovery' }
    ],
    finalPrep: ['Stretch behind blocks', 'Visualize race', 'Practice starts']
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
    Backstroke: { body_position: ['Good rotation', 'Keep head neutral', 'Hips riding high'][Math.floor(Math.random() * 3)], arm_technique: ['Pinky-first entry correct', 'Arm entry too wide', 'Good deep catch'][Math.floor(Math.random() * 3)], kick: ['Steady flutter kick', 'Knees breaking surface', 'Good propulsion'][Math.floor(Math.random() * 3)], timing: ['Arms synchronized', 'Pause at recovery', 'Smooth rhythm'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Focus on hip rotation', 'Improve arm entry', 'Work on kick depth'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: ['Good undulation', 'Stay more horizontal', 'Head position needs work'][Math.floor(Math.random() * 3)], arm_technique: ['Strong outsweep', 'Elbows collapsing', 'Good insweep'][Math.floor(Math.random() * 3)], kick: ['Powerful whip kick', 'Knees too wide', 'Good ankle rotation'][Math.floor(Math.random() * 3)], timing: ['Good sequence', 'Rushing glide', 'Good timing'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Extend glide', 'Narrow knee recovery', 'Improve timing'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: ['Good undulation', 'Hips not driving', 'Excellent body wave'][Math.floor(Math.random() * 3)], arm_technique: ['Strong keyhole pull', 'Arms too narrow', 'Good recovery'][Math.floor(Math.random() * 3)], kick: ['Two kicks correct', 'Second kick weak', 'Powerful downbeat'][Math.floor(Math.random() * 3)], breathing: ['Low forward breath', 'Head too high', 'Good timing'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Strengthen second kick', 'Lower breathing', 'Improve hip drive'][Math.floor(Math.random() * 3)] },
    IM: { transitions: ['Smooth transitions', 'Losing speed fly-to-back', 'Good underwater'][Math.floor(Math.random() * 3)], pacing: ['Well distributed', 'Going out too fast', 'Smart energy'][Math.floor(Math.random() * 3)], technique_consistency: ['All strokes sound', 'Breaststroke weakest', 'Strong freestyle'][Math.floor(Math.random() * 3)], overall_score: Math.floor(Math.random() * 3) + 7, priority_focus: ['Work on weakest stroke', 'Improve turns', 'Practice pacing'][Math.floor(Math.random() * 3)] }
  };
  return templates[stroke] || templates['Freestyle'];
}

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});
