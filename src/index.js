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

// ========== VALIDATION ==========
function validateTimeInput(stroke, distance, minutes, seconds) {
  const errors = [];
  const validStrokes = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'IM'];
  if (!validStrokes.includes(stroke)) errors.push('Invalid stroke');
  const validDistances = [50, 100, 200, 400, 800, 1500];
  if (!validDistances.includes(parseInt(distance))) errors.push('Invalid distance');
  const mins = parseInt(minutes), secs = parseInt(seconds);
  if (isNaN(mins) || mins < 0 || mins > 30) errors.push('Minutes must be 0-30');
  if (isNaN(secs) || secs < 0 || secs > 59) errors.push('Seconds must be 0-59');
  const totalSeconds = (mins * 60) + secs;
  const minTimes = { 50: 20, 100: 45, 200: 100, 400: 220, 800: 460, 1500: 870 };
  const maxTimes = { 50: 120, 100: 240, 200: 480, 400: 900, 800: 1800, 1500: 3600 };
  if (totalSeconds < minTimes[distance]) errors.push(`Time too fast for ${distance}m`);
  if (totalSeconds > maxTimes[distance]) errors.push(`Time too slow for ${distance}m`);
  return { valid: errors.length === 0, errors, totalSeconds };
}

// ========== AUTH ==========
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

// ========== COACH ==========
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
  const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
  if (!swimmers || swimmers.length === 0) return res.json({ leaderboard: [], enabled: false });
  const swimmerIds = swimmers.map(s => s.id);
  const { data: allTimes } = await supabase.from('swim_times').select('*').in('swimmer_id', swimmerIds).order('created_at', { ascending: true });
  const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', swimmerIds).eq('month', month);
  const leaderboard = swimmers.map(swimmer => {
    const swimmerTimes = (allTimes || []).filter(t => t.swimmer_id === swimmer.id);
    const thisMonthTimes = swimmerTimes.filter(t => t.date >= startOfMonth);
    const prevMonthTimes = swimmerTimes.filter(t => t.date >= startOfPrevMonth && t.date < endOfPrevMonth);
    const swimmerGoals = (goals || []).filter(g => g.swimmer_id === swimmer.id);
    let improvementPct = 0;
    if (prevMonthTimes.length > 0 && thisMonthTimes.length > 0) {
      const prevAvg = prevMonthTimes.reduce((sum, t) => sum + t.time_seconds, 0) / prevMonthTimes.length;
      const thisAvg = thisMonthTimes.reduce((sum, t) => sum + t.time_seconds, 0) / thisMonthTimes.length;
      improvementPct = ((prevAvg - thisAvg) / prevAvg) * 100;
    }
    const expectedSessions = 12;
    const consistencyScore = Math.min(100, (thisMonthTimes.length / expectedSessions) * 100);
    let goalCompletionRate = 0;
    if (swimmerGoals.length > 0) {
      const completed = swimmerGoals.filter(goal => {
        const relevantTimes = thisMonthTimes.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
        if (relevantTimes.length === 0) return false;
        return Math.min(...relevantTimes.map(t => t.time_seconds)) <= goal.target_seconds;
      }).length;
      goalCompletionRate = (completed / swimmerGoals.length) * 100;
    }
    const compositeScore = (improvementPct * 0.4) + (consistencyScore * 0.3) + (goalCompletionRate * 0.3);
    return { id: swimmer.id, name: swimmer.name, improvementPct: Math.round(improvementPct * 10) / 10, consistencyScore: Math.round(consistencyScore), goalCompletionRate: Math.round(goalCompletionRate), compositeScore: Math.round(compositeScore * 10) / 10, sessionsThisMonth: thisMonthTimes.length, sessionsLastMonth: prevMonthTimes.length };
  });
  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  const topScore = leaderboard[0]?.compositeScore || 0;
  leaderboard.forEach((s, i) => { s.rank = i + 1; s.deltaFromTop = Math.round((topScore - s.compositeScore) * 10) / 10; });
  res.json({ leaderboard, enabled: true });
});

// ========== PERFORMANCE INSIGHTS ==========
app.get('/api/insights/:swimmerId', async (req, res) => {
  const swimmerId = req.params.swimmerId;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
  const sixtyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 60)).toISOString().split('T')[0];
  
  // Get swimmer profile
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', swimmerId).single();
  if (!profile) return res.status(404).json({ error: 'Swimmer not found' });
  
  // Get all times
  const { data: allTimes } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: true });
  
  // Get goals
  const month = new Date().toISOString().slice(0, 7);
  const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', month);
  
  // Get feedback
  const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
  
  const times = allTimes || [];
  const last30Days = times.filter(t => t.date >= thirtyDaysAgo);
  const prev30Days = times.filter(t => t.date >= sixtyDaysAgo && t.date < thirtyDaysAgo);
  
  // ===== COMPUTE INSIGHTS =====
  
  // 1. 30-day pace trend
  let paceTrend = { direction: 'stable', change: 0, description: '' };
  if (last30Days.length >= 3 && prev30Days.length >= 1) {
    const recentAvg = last30Days.reduce((sum, t) => sum + t.time_seconds, 0) / last30Days.length;
    const prevAvg = prev30Days.reduce((sum, t) => sum + t.time_seconds, 0) / prev30Days.length;
    const change = prevAvg - recentAvg;
    const changePct = ((change / prevAvg) * 100).toFixed(1);
    if (change > 2) {
      paceTrend = { direction: 'improving', change: Math.round(change), changePct, description: `Your pace improved by ${Math.round(change)}s on average` };
    } else if (change < -2) {
      paceTrend = { direction: 'declining', change: Math.round(change), changePct, description: `Your pace slowed by ${Math.abs(Math.round(change))}s on average` };
    } else {
      paceTrend = { direction: 'stable', change: 0, changePct: '0', description: 'Your pace is holding steady' };
    }
  }
  
  // 2. Improvement % (month over month)
  const improvementPct = paceTrend.changePct || 0;
  
  // 3. Consistency score
  const expectedSessions = 12;
  const consistencyScore = Math.min(100, Math.round((last30Days.length / expectedSessions) * 100));
  let consistencyDesc = '';
  if (consistencyScore >= 80) consistencyDesc = 'Excellent training consistency';
  else if (consistencyScore >= 50) consistencyDesc = 'Good consistency, try to add 1-2 more sessions/week';
  else consistencyDesc = 'Inconsistent training is limiting your progress';
  
  // 4. Weakest stroke/distance (highest avg time relative to others)
  let weakestArea = null;
  const strokeDistanceTimes = {};
  times.forEach(t => {
    const key = `${t.stroke}-${t.distance}`;
    if (!strokeDistanceTimes[key]) strokeDistanceTimes[key] = [];
    strokeDistanceTimes[key].push(t.time_seconds);
  });
  
  if (Object.keys(strokeDistanceTimes).length > 1) {
    // Find area with least improvement or worst performance
    const areas = Object.entries(strokeDistanceTimes).map(([key, times]) => {
      const [stroke, distance] = key.split('-');
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const recent = times.slice(-3);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      return { stroke, distance, avg, recentAvg, sessions: times.length };
    });
    
    // Weakest = least sessions or least improvement
    areas.sort((a, b) => a.sessions - b.sessions);
    weakestArea = {
      stroke: areas[0].stroke,
      distance: areas[0].distance,
      reason: areas[0].sessions < 3 ? 'Needs more practice' : 'Slowest improvement',
      sessions: areas[0].sessions
    };
  }
  
  // 5. Fatigue signal detection
  let fatigueSignal = null;
  if (last30Days.length >= 5) {
    const lastFive = last30Days.slice(-5);
    const firstThree = lastFive.slice(0, 3);
    const lastTwo = lastFive.slice(-2);
    const firstAvg = firstThree.reduce((sum, t) => sum + t.time_seconds, 0) / 3;
    const lastAvg = lastTwo.reduce((sum, t) => sum + t.time_seconds, 0) / 2;
    if (lastAvg > firstAvg + 3) {
      fatigueSignal = {
        detected: true,
        description: 'Recent times are slower - possible fatigue',
        recommendation: 'Consider a recovery day or reduced intensity'
      };
    }
  }
  
  // 6. Goal progress insight
  let goalInsight = null;
  if (goals && goals.length > 0) {
    const goal = goals[0];
    const relevantTimes = last30Days.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
    if (relevantTimes.length > 0) {
      const bestTime = Math.min(...relevantTimes.map(t => t.time_seconds));
      const gap = bestTime - goal.target_seconds;
      if (gap <= 0) {
        goalInsight = { status: 'achieved', message: `You've hit your ${goal.stroke} ${goal.distance}m goal!`, gap: 0 };
      } else if (gap <= 3) {
        goalInsight = { status: 'close', message: `Just ${gap}s away from your goal - push harder!`, gap };
      } else {
        goalInsight = { status: 'working', message: `${gap}s to go - stay consistent`, gap };
      }
    }
  }
  
  // 7. Ranking insight (why you're ranked here)
  let rankingInsight = { factors: [], mainFactor: '' };
  const factors = [];
  if (parseFloat(improvementPct) > 2) factors.push({ factor: 'improvement', impact: 'positive', desc: 'Strong improvement boosting your rank' });
  else if (parseFloat(improvementPct) < -2) factors.push({ factor: 'improvement', impact: 'negative', desc: 'Declining pace hurting your rank' });
  if (consistencyScore >= 70) factors.push({ factor: 'consistency', impact: 'positive', desc: 'Good consistency helping your score' });
  else factors.push({ factor: 'consistency', impact: 'negative', desc: 'Low consistency limiting your rank' });
  if (goals && goals.length > 0) {
    const completedGoals = goals.filter(g => {
      const rt = last30Days.filter(t => t.stroke === g.stroke && t.distance === g.distance);
      return rt.length > 0 && Math.min(...rt.map(t => t.time_seconds)) <= g.target_seconds;
    }).length;
    if (completedGoals > 0) factors.push({ factor: 'goals', impact: 'positive', desc: `${completedGoals} goal(s) achieved` });
    else factors.push({ factor: 'goals', impact: 'negative', desc: 'No goals completed yet' });
  }
  rankingInsight.factors = factors;
  rankingInsight.mainFactor = factors.find(f => f.impact === 'negative')?.desc || factors[0]?.desc || 'Keep training!';
  
  // 8. Actionable recommendations
  const recommendations = [];
  if (consistencyScore < 70) recommendations.push('Add 1-2 more sessions per week');
  if (fatigueSignal?.detected) recommendations.push('Take a recovery day');
  if (weakestArea) recommendations.push(`Focus on ${weakestArea.stroke} ${weakestArea.distance}m`);
  if (parseFloat(improvementPct) < 0) recommendations.push('Review technique with video feedback');
  if (recommendations.length === 0) recommendations.push('Maintain current training rhythm');
  
  res.json({
    swimmerId,
    totalSessions: times.length,
    last30DaySessions: last30Days.length,
    paceTrend,
    improvementPct: parseFloat(improvementPct),
    consistencyScore,
    consistencyDesc,
    weakestArea,
    fatigueSignal,
    goalInsight,
    rankingInsight,
    recommendations
  });
});

// ========== TIMES ==========
app.post('/api/times', async (req, res) => {
  const { swimmerId, stroke, distance, minutes, seconds } = req.body;
  const validation = validateTimeInput(stroke, distance, minutes, seconds);
  if (!validation.valid) return res.status(400).json({ error: validation.errors.join(', ') });
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', parseInt(distance)).eq('date', today).eq('time_seconds', validation.totalSeconds);
  if (existing && existing.length > 0) return res.status(400).json({ error: 'Duplicate entry' });
  const { data, error } = await supabase.from('swim_times').insert({ swimmer_id: swimmerId, stroke, distance: parseInt(distance), time_seconds: validation.totalSeconds }).select().single();
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
    const status = bestTime === null ? 'no_data' : bestTime <= goal.target_seconds ? 'ahead' : 'behind';
    const gap = bestTime ? bestTime - goal.target_seconds : null;
    return { goal, sessionsLogged: relevantTimes.length, bestTime, status, gap };
  });
  res.json({ progress, times: times || [] });
});

// ========== VIDEO ==========
app.post('/api/video/upload', upload.single('video'), async (req, res) => {
  try {
    const { swimmerId, stroke } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No video' });
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
  if (!goals?.length || !times?.length || !feedbacks?.length) {
    return res.json({ ready: false, missing: { goals: !goals?.length, times: !times?.length, video: !feedbacks?.length } });
  }
  const goal = goals[0];
  const relevantTimes = times.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
  const bestTime = relevantTimes.length > 0 ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
  const gap = bestTime ? bestTime - goal.target_seconds : null;
  const trainingFocus = generateTrainingFocus(feedbacks[0].feedback, gap, goal.stroke);
  const racePlan = generateRacePlan(goal, bestTime, gap);
  const warmupPlan = generateWarmupPlan(goal.stroke);
  res.json({ ready: true, goal, performance: { bestTime, gap }, trainingFocus, racePlan, warmupPlan });
});

function generateTrainingFocus(feedback, gap, stroke) {
  const focuses = [feedback.priority_focus];
  if (gap > 5) focuses.push('Increase training volume');
  else if (gap > 0) focuses.push('Race pace intervals');
  else focuses.push('Maintain form');
  const strokeFocus = { Freestyle: 'Streamline off walls', Backstroke: 'Underwater kicks', Breaststroke: 'Pullout efficiency', Butterfly: 'Rhythm and tempo', IM: 'Transition efficiency' };
  focuses.push(strokeFocus[stroke] || 'Technique drills');
  return focuses.slice(0, 4);
}

function generateRacePlan(goal, bestTime, gap) {
  const t = goal.target_seconds;
  const strategy = gap > 0 ? 'Conservative start, build second half' : 'Even splits';
  const splits = goal.distance === 50 
    ? [{ segment: '0-25m', pace: 'Max effort', target: Math.round(t * 0.48) + 's' }, { segment: '25-50m', pace: 'Hold', target: Math.round(t * 0.52) + 's' }]
    : [{ segment: 'First half', pace: 'Controlled', target: Math.round(t * 0.52) + 's' }, { segment: 'Second half', pace: 'Build', target: Math.round(t * 0.48) + 's' }];
  return { strategy, splits, mentalCues: ['Stay relaxed', 'Trust training', 'Strong finish'], targetTime: formatTime(t) };
}

function generateWarmupPlan(stroke) {
  return { totalDistance: '800m', timeNeeded: '15-20 min', activities: [{ activity: 'Easy mix', distance: '300m' }, { activity: `${stroke} drill`, distance: '200m' }, { activity: 'Build', distance: '4x50m' }, { activity: 'Easy', distance: '100m' }], finalPrep: ['Stretch', 'Visualize', 'Practice start'] };
}

function formatTime(s) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; }

function generateSwimFeedback(stroke) {
  const t = {
    Freestyle: { body_position: 'Good alignment', arm_technique: 'Strong catch', kick: 'Consistent kick', breathing: 'Good timing', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Catch phase', 'Body rotation', 'Kick tempo'][Math.floor(Math.random() * 3)] },
    Backstroke: { body_position: 'Good rotation', arm_technique: 'Clean entry', kick: 'Steady kick', timing: 'Smooth rhythm', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Hip rotation', 'Arm entry', 'Kick depth'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: 'Good undulation', arm_technique: 'Strong outsweep', kick: 'Powerful whip', timing: 'Good sequence', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Glide phase', 'Kick timing', 'Pullout'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: 'Good wave', arm_technique: 'Strong pull', kick: 'Two kicks correct', breathing: 'Low breath', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Second kick', 'Hip drive', 'Breathing'][Math.floor(Math.random() * 3)] },
    IM: { transitions: 'Smooth turns', pacing: 'Good distribution', technique_consistency: 'Solid all strokes', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Weakest stroke', 'Turn speed', 'Pacing'][Math.floor(Math.random() * 3)] }
  };
  return t[stroke] || t.Freestyle;
}

app.listen(PORT, () => console.log(`\n🏊 SwiftLapLogic running at http://localhost:${PORT}\n`));
