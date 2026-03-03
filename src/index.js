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

// ========== ERROR LOGGING ==========
const logError = async (error, context = {}) => {
  console.error(`[ERROR] ${new Date().toISOString()}:`, error.message, context);
  try {
    await supabase.from('analytics').insert({
      user_id: context.userId || null,
      event_type: 'error',
      event_data: { message: error.message, stack: error.stack, context }
    });
  } catch (e) { console.error('Failed to log error:', e); }
};

// ========== ANALYTICS ==========
const trackEvent = async (userId, eventType, eventData = {}) => {
  try {
    await supabase.from('analytics').insert({ user_id: userId, event_type: eventType, event_data: eventData });
  } catch (e) { console.error('Failed to track event:', e); }
};

app.post('/api/analytics/track', async (req, res) => {
  const { userId, eventType, eventData } = req.body;
  await trackEvent(userId, eventType, eventData);
  res.json({ success: true });
});

app.get('/api/analytics/summary', async (req, res) => {
  try {
    const { data: events } = await supabase.from('analytics').select('*').order('created_at', { ascending: false }).limit(100);
    
    const summary = {
      totalEvents: events?.length || 0,
      byType: {},
      recentErrors: [],
      userActivity: {}
    };
    
    (events || []).forEach(e => {
      summary.byType[e.event_type] = (summary.byType[e.event_type] || 0) + 1;
      if (e.event_type === 'error') summary.recentErrors.push(e);
      if (e.user_id) summary.userActivity[e.user_id] = (summary.userActivity[e.user_id] || 0) + 1;
    });
    
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics/leaderboard-engagement', async (req, res) => {
  try {
    const { data } = await supabase.from('analytics').select('*').eq('event_type', 'leaderboard_view');
    const views = data?.length || 0;
    const uniqueUsers = new Set((data || []).map(e => e.user_id)).size;
    res.json({ totalViews: views, uniqueUsers, avgViewsPerUser: uniqueUsers ? (views / uniqueUsers).toFixed(1) : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== VALIDATION ==========
function validateTimeInput(stroke, distance, minutes, seconds) {
  const errors = [];
  const validStrokes = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'IM'];
  if (!validStrokes.includes(stroke)) errors.push('Invalid stroke');
  const validDistances = [50, 100, 200, 400, 800, 1500];
  if (!validDistances.includes(parseInt(distance))) errors.push('Invalid distance');
  const mins = parseInt(minutes), secs = parseInt(seconds);
  if (isNaN(mins) || mins < 0 || mins > 30) errors.push('Minutes 0-30');
  if (isNaN(secs) || secs < 0 || secs > 59) errors.push('Seconds 0-59');
  const totalSeconds = (mins * 60) + secs;
  const minT = { 50: 20, 100: 45, 200: 100, 400: 220, 800: 460, 1500: 870 };
  const maxT = { 50: 120, 100: 240, 200: 480, 400: 900, 800: 1800, 1500: 3600 };
  if (totalSeconds < minT[distance]) errors.push('Too fast');
  if (totalSeconds > maxT[distance]) errors.push('Too slow');
  return { valid: errors.length === 0, errors, totalSeconds };
}

// ========== AUTH ==========
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(profile.id, 'signup', { role: profile.role });
    res.json({ success: true, user: profile });
  } catch (e) { await logError(e, { route: 'signup' }); res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    await trackEvent(profile.id, 'login', { role: profile.role });
    res.json({ success: true, user: profile, session: data.session });
  } catch (e) { await logError(e, { route: 'login' }); res.status(500).json({ error: e.message }); }
});

// ========== COACH ==========
app.post('/api/coach/add-swimmer', async (req, res) => {
  try {
    const { email, password, name, coachId } = req.body;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: 'swimmer', coach_id: coachId }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(coachId, 'add_swimmer', { swimmerId: profile.id });
    res.json({ success: true, swimmer: profile });
  } catch (e) { await logError(e, { route: 'add-swimmer' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ swimmers: data });
  } catch (e) { await logError(e, { route: 'coach-swimmers' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/coach/dashboard/:coachId', async (req, res) => {
  try {
    const coachId = req.params.coachId;
    const month = new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;
    const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
    if (!swimmers?.length) return res.json({ swimmers: [], summary: { total: 0, ahead: 0, behind: 0, noGoals: 0 } });
    const ids = swimmers.map(s => s.id);
    const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', ids).eq('month', month);
    const { data: times } = await supabase.from('swim_times').select('*').in('swimmer_id', ids).gte('date', startOfMonth);
    const { data: feedbacks } = await supabase.from('video_feedback').select('*').in('swimmer_id', ids).order('created_at', { ascending: false });
    const { data: plans } = await supabase.from('training_plans').select('*').in('swimmer_id', ids).order('created_at', { ascending: false });
    const swimmerData = swimmers.map(s => {
      const sg = (goals || []).filter(g => g.swimmer_id === s.id);
      const st = (times || []).filter(t => t.swimmer_id === s.id);
      const sf = (feedbacks || []).find(f => f.swimmer_id === s.id);
      const sp = (plans || []).find(p => p.swimmer_id === s.id);
      let status = 'no_goals', goalsAhead = 0, goalsBehind = 0, improvement = 0;
      sg.forEach(g => {
        const rt = st.filter(t => t.stroke === g.stroke && t.distance === g.distance);
        if (rt.length) {
          const best = Math.min(...rt.map(t => t.time_seconds));
          if (best <= g.target_seconds) goalsAhead++; else goalsBehind++;
        }
      });
      if (sg.length) status = goalsBehind > 0 ? 'behind' : 'ahead';
      return { ...s, goalsCount: sg.length, goalsAhead, goalsBehind, sessionsThisMonth: st.length, status, improvement, latestFeedback: sf || null, currentPlan: sp || null };
    });
    const summary = { total: swimmers.length, ahead: swimmerData.filter(s => s.status === 'ahead').length, behind: swimmerData.filter(s => s.status === 'behind').length, noGoals: swimmerData.filter(s => s.status === 'no_goals').length };
    await trackEvent(coachId, 'dashboard_view', { swimmerCount: swimmers.length });
    res.json({ swimmers: swimmerData, summary });
  } catch (e) { await logError(e, { route: 'coach-dashboard' }); res.status(500).json({ error: e.message }); }
});

// ========== LEADERBOARD ==========
app.get('/api/leaderboard/:coachId', async (req, res) => {
  try {
    const coachId = req.params.coachId;
    const month = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`, startOfPrev = `${prevMonth}-01`;
    const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', coachId);
    if (!swimmers?.length) return res.json({ leaderboard: [], enabled: false });
    const ids = swimmers.map(s => s.id);
    const { data: allTimes } = await supabase.from('swim_times').select('*').in('swimmer_id', ids);
    const { data: goals } = await supabase.from('goals').select('*').in('swimmer_id', ids).eq('month', month);
    const lb = swimmers.map(s => {
      const st = (allTimes || []).filter(t => t.swimmer_id === s.id);
      const thisM = st.filter(t => t.date >= startOfMonth);
      const prevM = st.filter(t => t.date >= startOfPrev && t.date < startOfMonth);
      const sg = (goals || []).filter(g => g.swimmer_id === s.id);
      let impPct = 0;
      if (prevM.length && thisM.length) {
        const pAvg = prevM.reduce((a, t) => a + t.time_seconds, 0) / prevM.length;
        const tAvg = thisM.reduce((a, t) => a + t.time_seconds, 0) / thisM.length;
        impPct = ((pAvg - tAvg) / pAvg) * 100;
      }
      const cons = Math.min(100, (thisM.length / 12) * 100);
      let goalRate = 0;
      if (sg.length) {
        const done = sg.filter(g => {
          const rt = thisM.filter(t => t.stroke === g.stroke && t.distance === g.distance);
          return rt.length && Math.min(...rt.map(t => t.time_seconds)) <= g.target_seconds;
        }).length;
        goalRate = (done / sg.length) * 100;
      }
      const score = (impPct * 0.4) + (cons * 0.3) + (goalRate * 0.3);
      return { id: s.id, name: s.name, improvementPct: Math.round(impPct * 10) / 10, consistencyScore: Math.round(cons), goalCompletionRate: Math.round(goalRate), compositeScore: Math.round(score * 10) / 10 };
    });
    lb.sort((a, b) => b.compositeScore - a.compositeScore);
    const top = lb[0]?.compositeScore || 0;
    lb.forEach((s, i) => { s.rank = i + 1; s.deltaFromTop = Math.round((top - s.compositeScore) * 10) / 10; });
    res.json({ leaderboard: lb, enabled: true });
  } catch (e) { await logError(e, { route: 'leaderboard' }); res.status(500).json({ error: e.message }); }
});

// ========== INSIGHTS ==========
app.get('/api/insights/:swimmerId', async (req, res) => {
  try {
    const swimmerId = req.params.swimmerId;
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const d60 = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', new Date().toISOString().slice(0, 7)).order('created_at', { ascending: false });
    const t = times || [];
    const last30 = t.filter(x => x.date >= d30);
    const prev30 = t.filter(x => x.date >= d60 && x.date < d30);
    let paceTrend = { direction: 'stable', description: 'Keep training' };
    if (last30.length >= 3 && prev30.length >= 1) {
      const rAvg = last30.reduce((a, x) => a + x.time_seconds, 0) / last30.length;
      const pAvg = prev30.reduce((a, x) => a + x.time_seconds, 0) / prev30.length;
      const ch = pAvg - rAvg;
      if (ch > 2) paceTrend = { direction: 'improving', description: `Improved ${Math.round(ch)}s` };
      else if (ch < -2) paceTrend = { direction: 'declining', description: `Slowed ${Math.abs(Math.round(ch))}s` };
    }
    const cons = Math.min(100, Math.round((last30.length / 12) * 100));
    const consDesc = cons >= 80 ? 'Excellent' : cons >= 50 ? 'Good' : 'Inconsistent';
    let goalInsight = null;
    if (goals?.length) {
      const g = goals[0];
      const rt = last30.filter(x => x.stroke === g.stroke && x.distance === g.distance);
      if (rt.length) {
        const best = Math.min(...rt.map(x => x.time_seconds));
        const gap = best - g.target_seconds;
        if (gap <= 0) goalInsight = { status: 'achieved', message: 'Goal achieved!' };
        else if (gap <= 3) goalInsight = { status: 'close', message: `${gap}s away!` };
        else goalInsight = { status: 'working', message: `${gap}s to go` };
      }
    }
    let fatigueSignal = null;
    if (last30.length >= 5) {
      const l5 = last30.slice(-5);
      const fAvg = l5.slice(0, 3).reduce((a, x) => a + x.time_seconds, 0) / 3;
      const lAvg = l5.slice(-2).reduce((a, x) => a + x.time_seconds, 0) / 2;
      if (lAvg > fAvg + 3) fatigueSignal = { detected: true, recommendation: 'Consider recovery' };
    }
    const factors = [];
    if (paceTrend.direction === 'improving') factors.push({ impact: 'positive', desc: 'Improving pace' });
    else if (paceTrend.direction === 'declining') factors.push({ impact: 'negative', desc: 'Declining pace' });
    if (cons >= 70) factors.push({ impact: 'positive', desc: 'Good consistency' });
    else factors.push({ impact: 'negative', desc: 'Low consistency' });
    await trackEvent(swimmerId, 'insights_view', {});
    res.json({ totalSessions: t.length, last30DaySessions: last30.length, paceTrend, consistencyScore: cons, consistencyDesc: consDesc, goalInsight, fatigueSignal, rankingInsight: { mainFactor: factors.find(f => f.impact === 'negative')?.desc || factors[0]?.desc || 'Keep going!', factors } });
  } catch (e) { await logError(e, { route: 'insights' }); res.status(500).json({ error: e.message }); }
});

// ========== TRAINING PLAN ==========
app.get('/api/training-plan/:swimmerId', async (req, res) => {
  try {
    const swimmerId = req.params.swimmerId;
    const weekStart = getWeekStart(new Date());
    const month = new Date().toISOString().slice(0, 7);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('month', month).order('created_at', { ascending: false });
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
    const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', swimmerId).order('created_at', { ascending: false });
    if (!goals?.length || !times?.length || !feedbacks?.length) {
      return res.json({ ready: false, missing: { goals: !goals?.length, times: !times?.length, video: !feedbacks?.length } });
    }
    const goal = goals[0];
    const feedback = feedbacks[0];
    const relevantTimes = times.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
    const bestTime = relevantTimes.length ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
    const goalGap = bestTime ? bestTime - goal.target_seconds : 15;
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const consistencyScore = Math.min(100, Math.round((times.filter(t => t.date >= d30).length / 12) * 100));
    const { data: existingPlan } = await supabase.from('training_plans').select('*').eq('swimmer_id', swimmerId).eq('week_start', weekStart).single();
    const currentData = { goalGap, goalStroke: goal.stroke, goalDistance: goal.distance, consistency: consistencyScore, bestTime };
    if (existingPlan) {
      const old = existingPlan.generated_from || {};
      const shouldRegen = !old.goalStroke || old.goalStroke !== goal.stroke || old.goalDistance !== goal.distance || Math.abs((old.goalGap || 0) - goalGap) > 3 || Math.abs((old.consistency || 0) - consistencyScore) > 20;
      if (!shouldRegen) {
        await trackEvent(swimmerId, 'training_plan_view', { regenerated: false });
        return res.json({ ready: true, plan: existingPlan.plan, regenerated: false, weekStart });
      }
      const plan = generatePlan(goal, feedback, goalGap, consistencyScore, bestTime);
      await supabase.from('training_plans').update({ plan, generated_from: currentData }).eq('id', existingPlan.id);
      await trackEvent(swimmerId, 'training_plan_view', { regenerated: true });
      return res.json({ ready: true, plan, regenerated: true, weekStart });
    }
    const plan = generatePlan(goal, feedback, goalGap, consistencyScore, bestTime);
    await supabase.from('training_plans').insert({ swimmer_id: swimmerId, week_start: weekStart, plan, generated_from: currentData });
    await trackEvent(swimmerId, 'training_plan_view', { regenerated: true });
    res.json({ ready: true, plan, regenerated: true, weekStart });
  } catch (e) { await logError(e, { route: 'training-plan' }); res.status(500).json({ error: e.message }); }
});

function getWeekStart(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function generatePlan(goal, feedback, goalGap, consistency, bestTime) {
  const stroke = goal.stroke;
  const distance = goal.distance;
  const focus = feedback?.feedback?.priority_focus || 'technique';
  let intensity, intensityDesc;
  if (goalGap > 10) { intensity = 'high'; intensityDesc = 'Far from goal'; }
  else if (goalGap > 5) { intensity = 'high'; intensityDesc = 'Building toward goal'; }
  else if (goalGap > 0) { intensity = 'moderate'; intensityDesc = 'Close to goal'; }
  else { intensity = 'maintenance'; intensityDesc = 'Goal achieved'; }
  const focusAreas = [focus];
  if (goalGap > 10) focusAreas.push('Endurance', 'Volume');
  else if (goalGap > 5) focusAreas.push('Race pace', 'Threshold');
  else if (goalGap > 0) focusAreas.push('Speed', 'Race simulation');
  else focusAreas.push('Technique', 'Consistency');
  const workouts = generateDistanceWorkouts(stroke, distance, goalGap, focus, intensity);
  const tips = [];
  if (goalGap > 10) tips.push(`${goalGap}s from goal - focus on volume`);
  else if (goalGap > 5) tips.push(`${goalGap}s to go - push race pace`);
  else if (goalGap > 0) tips.push(`Only ${goalGap}s away!`);
  else tips.push('Goal achieved! Maintain form');
  if (bestTime) tips.push(`Best: ${formatTime(bestTime)} → Target: ${formatTime(goal.target_seconds)}`);
  return { weekFocus: `${stroke} ${distance}m - ${intensity}`, focusAreas: focusAreas.slice(0, 4), intensity, intensityDesc, goalGap: goalGap > 0 ? `${goalGap}s to drop` : 'Goal achieved!', workouts, totalWeeklyDistance: workouts.reduce((a, w) => a + parseInt(w.totalDistance), 0) + 'm', sessionsPerWeek: workouts.length, tips, adaptedFrom: { goalGap, focus, consistency, bestTime, targetTime: goal.target_seconds } };
}

function generateDistanceWorkouts(stroke, distance, goalGap, focus, intensity) {
  const workouts = [];
  if (distance === 50) {
    workouts.push({ day: 'Monday', type: 'Power', warmup: '300m easy', main: [{ set: `12x25m ${stroke} FAST`, rest: '30s', focus: 'Speed' }, { set: '8x15m sprint', rest: '45s', focus: 'Starts' }], cooldown: '200m easy', totalDistance: '1100m', focus: 'Sprint power' });
    workouts.push({ day: 'Wednesday', type: 'Speed Endurance', warmup: '400m drill', main: [{ set: `6x50m ${stroke} descend`, rest: '40s', focus: 'Build' }, { set: `8x25m ${stroke} drill`, rest: '20s', focus }], cooldown: '200m easy', totalDistance: '1200m', focus: 'Speed + technique' });
    workouts.push({ day: 'Friday', type: 'Race Sim', warmup: '300m warmup', main: [{ set: `6x50m ${stroke} race pace`, rest: '2min', focus: 'Goal time' }, { set: `2x50m ALL OUT`, rest: '3min', focus: 'Time trial' }], cooldown: '200m easy', totalDistance: '1000m', focus: 'Race prep' });
  } else if (distance === 100) {
    workouts.push({ day: 'Monday', type: 'Speed & Turns', warmup: '400m easy', main: [{ set: `8x50m ${stroke} fast`, rest: '30s', focus: 'Speed' }, { set: '8x25m turns', rest: '20s', focus: 'Turns' }], cooldown: '200m easy', totalDistance: '1400m', focus: 'Speed' });
    workouts.push({ day: 'Wednesday', type: 'Threshold', warmup: '300m drill', main: [{ set: `6x100m ${stroke} threshold`, rest: '20s', focus: 'Aerobic' }, { set: `4x75m descend`, rest: '30s', focus: 'Build' }], cooldown: '200m easy', totalDistance: '1600m', focus: 'Threshold' });
    workouts.push({ day: 'Friday', type: 'Race Pace', warmup: '400m warmup', main: [{ set: `3x100m ${stroke} goal pace`, rest: '2min', focus: 'Target' }, { set: `2x100m TIME TRIAL`, rest: '3min', focus: 'Race sim' }], cooldown: '200m easy', totalDistance: '1300m', focus: 'Race' });
  } else {
    const reps = distance === 200 ? 4 : 3;
    workouts.push({ day: 'Monday', type: 'Endurance', warmup: '500m easy', main: [{ set: `${reps}x${distance}m ${stroke}`, rest: '30s', focus: 'Aerobic' }, { set: '4x100m kick', rest: '20s', focus: 'Legs' }], cooldown: '300m easy', totalDistance: `${(reps * distance) + 1200}m`, focus: 'Endurance' });
    workouts.push({ day: 'Wednesday', type: 'Pacing', warmup: '400m drill', main: [{ set: `${reps + 2}x${distance / 2}m negative split`, rest: '25s', focus: 'Pacing' }, { set: '4x50m FAST', rest: '30s', focus: 'Speed' }], cooldown: '300m easy', totalDistance: `${((reps + 2) * distance / 2) + 900}m`, focus: 'Negative split' });
    workouts.push({ day: 'Friday', type: 'Race Pace', warmup: '500m warmup', main: [{ set: `2x${distance}m goal pace`, rest: '3min', focus: 'Race sim' }, { set: `1x${distance}m TIME TRIAL`, rest: '-', focus: 'Full effort' }], cooldown: '300m easy', totalDistance: `${3 * distance + 800}m`, focus: 'Race' });
  }
  if (intensity === 'high') {
    workouts.push({ day: 'Saturday', type: 'Technique', warmup: '300m easy', main: [{ set: `10x50m ${stroke} drill`, rest: '20s', focus }], cooldown: '200m easy', totalDistance: '1000m', focus: 'Technical' });
  }
  return workouts;
}

function formatTime(s) { if (!s) return '-'; return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; }

// ========== TIMES ==========
app.post('/api/times', async (req, res) => {
  try {
    const { swimmerId, stroke, distance, minutes, seconds } = req.body;
    const v = validateTimeInput(stroke, distance, minutes, seconds);
    if (!v.valid) return res.status(400).json({ error: v.errors.join(', ') });
    const today = new Date().toISOString().split('T')[0];
    const { data: ex } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', parseInt(distance)).eq('date', today).eq('time_seconds', v.totalSeconds);
    if (ex?.length) return res.status(400).json({ error: 'Duplicate' });
    const { data, error } = await supabase.from('swim_times').insert({ swimmer_id: swimmerId, stroke, distance: parseInt(distance), time_seconds: v.totalSeconds }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(swimmerId, 'time_logged', { stroke, distance, time: v.totalSeconds });
    res.json({ success: true, time: data });
  } catch (e) { await logError(e, { route: 'times-post' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/times/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ times: data });
  } catch (e) { await logError(e, { route: 'times-get' }); res.status(500).json({ error: e.message }); }
});

// ========== GOALS ==========
app.post('/api/goals', async (req, res) => {
  try {
    const { swimmerId, stroke, distance, targetMinutes, targetSeconds } = req.body;
    const target = (parseInt(targetMinutes) * 60) + parseInt(targetSeconds);
    const month = new Date().toISOString().slice(0, 7);
    const { data: ex } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', distance).eq('month', month).single();
    let data, error;
    if (ex) ({ data, error } = await supabase.from('goals').update({ target_seconds: target }).eq('id', ex.id).select().single());
    else ({ data, error } = await supabase.from('goals').insert({ swimmer_id: swimmerId, stroke, distance, target_seconds: target, month }).select().single());
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(swimmerId, 'goal_set', { stroke, distance, target });
    res.json({ success: true, goal: data });
  } catch (e) { await logError(e, { route: 'goals-post' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/goals/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', new Date().toISOString().slice(0, 7)).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ goals: data });
  } catch (e) { await logError(e, { route: 'goals-get' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/progress/:swimmerId', async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', month).order('created_at', { ascending: false });
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).gte('date', `${month}-01`);
    const progress = (goals || []).map(g => {
      const rt = (times || []).filter(t => t.stroke === g.stroke && t.distance === g.distance);
      const best = rt.length ? Math.min(...rt.map(t => t.time_seconds)) : null;
      const status = best === null ? 'no_data' : best <= g.target_seconds ? 'ahead' : 'behind';
      return { goal: g, sessionsLogged: rt.length, bestTime: best, status, gap: best ? best - g.target_seconds : null };
    });
    res.json({ progress, times: times || [] });
  } catch (e) { await logError(e, { route: 'progress' }); res.status(500).json({ error: e.message }); }
});

// ========== VIDEO ==========
app.post('/api/video/upload', upload.single('video'), async (req, res) => {
  try {
    const { swimmerId, stroke } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No video' });
    const fileName = `${swimmerId}/${Date.now()}-${req.file.originalname}`;
    const { error: upErr } = await supabase.storage.from('videos').upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
    if (upErr) return res.status(400).json({ error: upErr.message });
    const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(fileName);
    const feedback = genFeedback(stroke);
    const { data, error } = await supabase.from('video_feedback').insert({ swimmer_id: swimmerId, video_url: publicUrl, stroke, feedback }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await trackEvent(swimmerId, 'video_uploaded', { stroke });
    res.json({ success: true, feedback: data });
  } catch (e) { await logError(e, { route: 'video-upload' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/video/feedback/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ feedbacks: data });
  } catch (e) { await logError(e, { route: 'video-feedback' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/race-plan/:swimmerId', async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', month).order('created_at', { ascending: false });
    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId);
    const { data: feedbacks } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId);
    if (!goals?.length || !times?.length || !feedbacks?.length) return res.json({ ready: false, missing: { goals: !goals?.length, times: !times?.length, video: !feedbacks?.length } });
    const g = goals[0];
    const rt = times.filter(t => t.stroke === g.stroke && t.distance === g.distance);
    const best = rt.length ? Math.min(...rt.map(t => t.time_seconds)) : null;
    const gap = best ? best - g.target_seconds : null;
    res.json({ ready: true, goal: g, performance: { bestTime: best, gap }, trainingFocus: [feedbacks[0].feedback.priority_focus, gap > 5 ? 'Volume' : 'Race pace'], racePlan: { strategy: gap > 0 ? 'Conservative start' : 'Even splits', splits: [{ segment: 'First half', target: Math.round(g.target_seconds * 0.52) + 's' }, { segment: 'Second half', target: Math.round(g.target_seconds * 0.48) + 's' }], mentalCues: ['Stay relaxed', 'Strong finish'], targetTime: formatTime(g.target_seconds) } });
  } catch (e) { await logError(e, { route: 'race-plan' }); res.status(500).json({ error: e.message }); }
});

function genFeedback(stroke) {
  const t = {
    Freestyle: { body_position: 'Good', arm_technique: 'Strong catch', kick: 'Consistent', breathing: 'Good timing', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Catch', 'Rotation', 'Kick'][Math.floor(Math.random() * 3)] },
    Backstroke: { body_position: 'Good rotation', arm_technique: 'Clean', kick: 'Steady', timing: 'Smooth', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Hip rotation', 'Arm entry', 'Kick'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: 'Good undulation', arm_technique: 'Strong', kick: 'Powerful', timing: 'Good', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Glide', 'Kick timing', 'Pullout'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: 'Good wave', arm_technique: 'Strong', kick: 'Two kicks', breathing: 'Low', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Second kick', 'Hip drive', 'Breathing'][Math.floor(Math.random() * 3)] },
    IM: { transitions: 'Smooth', pacing: 'Good', technique_consistency: 'Solid', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Weakest stroke', 'Turns', 'Pacing'][Math.floor(Math.random() * 3)] }
  };
  return t[stroke] || t.Freestyle;
}

app.listen(PORT, () => console.log(`\n🏊 SwiftLapLogic at http://localhost:${PORT}\n`));
