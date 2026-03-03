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

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body;
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return res.status(400).json({ error: authError.message });
  const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: role || 'swimmer' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: profile });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  res.json({ success: true, user: profile, session: data.session });
});

app.post('/api/coach/add-swimmer', async (req, res) => {
  const { email, password, name, coachId } = req.body;
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return res.status(400).json({ error: authError.message });
  const { data: profile, error } = await supabase.from('profiles').insert({ id: authData.user.id, email, name, role: 'swimmer', coach_id: coachId }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, swimmer: profile });
});

app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ swimmers: data });
});

app.get('/api/coach/dashboard/:coachId', async (req, res) => {
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
        if (rt.length >= 2) {
          const sorted = rt.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          improvement = Math.max(improvement, sorted[0].time_seconds - best);
        }
      }
    });
    if (sg.length) status = goalsBehind > 0 ? 'behind' : 'ahead';
    return { ...s, goalsCount: sg.length, goalsAhead, goalsBehind, sessionsThisMonth: st.length, status, improvement, latestFeedback: sf || null, currentPlan: sp || null };
  });
  const summary = { total: swimmers.length, ahead: swimmerData.filter(s => s.status === 'ahead').length, behind: swimmerData.filter(s => s.status === 'behind').length, noGoals: swimmerData.filter(s => s.status === 'no_goals').length };
  res.json({ swimmers: swimmerData, summary });
});

app.get('/api/leaderboard/:coachId', async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const prevMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  const startOfMonth = `${month}-01`, startOfPrev = `${prevMonth}-01`;
  const { data: swimmers } = await supabase.from('profiles').select('*').eq('coach_id', req.params.coachId);
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
});

app.get('/api/insights/:swimmerId', async (req, res) => {
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
  res.json({ totalSessions: t.length, last30DaySessions: last30.length, paceTrend, consistencyScore: cons, consistencyDesc: consDesc, goalInsight, fatigueSignal, rankingInsight: { mainFactor: factors.find(f => f.impact === 'negative')?.desc || factors[0]?.desc || 'Keep going!', factors } });
});

app.get('/api/training-plan/:swimmerId', async (req, res) => {
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
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const last30 = times.filter(t => t.date >= d30);
  const relevantTimes = times.filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
  const bestTime = relevantTimes.length ? Math.min(...relevantTimes.map(t => t.time_seconds)) : null;
  const goalGap = bestTime ? bestTime - goal.target_seconds : 15; // Default 15s gap if no times
  const consistencyScore = Math.min(100, Math.round((last30.length / 12) * 100));
  
  // Check existing plan
  const { data: existingPlan } = await supabase.from('training_plans').select('*').eq('swimmer_id', swimmerId).eq('week_start', weekStart).single();
  
  const currentData = { goalGap, goalStroke: goal.stroke, goalDistance: goal.distance, consistency: consistencyScore, bestTime };
  
  if (existingPlan) {
    const old = existingPlan.generated_from || {};
    const shouldRegen = !old.goalStroke || 
                        old.goalStroke !== goal.stroke || 
                        old.goalDistance !== goal.distance || 
                        Math.abs((old.goalGap || 0) - goalGap) > 3 ||
                        Math.abs((old.consistency || 0) - consistencyScore) > 20;
    
    if (!shouldRegen) {
      return res.json({ ready: true, plan: existingPlan.plan, regenerated: false, weekStart });
    }
    
    const plan = generatePlan(goal, feedback, goalGap, consistencyScore, bestTime);
    await supabase.from('training_plans').update({ plan, generated_from: currentData }).eq('id', existingPlan.id);
    return res.json({ ready: true, plan, regenerated: true, weekStart });
  }
  
  const plan = generatePlan(goal, feedback, goalGap, consistencyScore, bestTime);
  await supabase.from('training_plans').insert({ swimmer_id: swimmerId, week_start: weekStart, plan, generated_from: currentData });
  res.json({ ready: true, plan, regenerated: true, weekStart });
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
  
  // Determine intensity based on gap
  let intensity, intensityDesc;
  if (goalGap > 10) { intensity = 'high'; intensityDesc = 'Far from goal - high volume needed'; }
  else if (goalGap > 5) { intensity = 'high'; intensityDesc = 'Building toward goal'; }
  else if (goalGap > 0) { intensity = 'moderate'; intensityDesc = 'Close to goal - refine technique'; }
  else { intensity = 'maintenance'; intensityDesc = 'Goal achieved - maintain form'; }
  
  // Focus areas based on gap and feedback
  const focusAreas = [focus];
  if (goalGap > 10) focusAreas.push('Endurance base', 'Volume building');
  else if (goalGap > 5) focusAreas.push('Race pace work', 'Threshold training');
  else if (goalGap > 0) focusAreas.push('Speed work', 'Race simulation');
  else focusAreas.push('Technique refinement', 'Consistency');
  if (consistency < 70) focusAreas.push('Build training habit');
  
  // Generate distance-specific workouts
  const workouts = generateDistanceWorkouts(stroke, distance, goalGap, focus, intensity);
  
  // Tips based on current state
  const tips = [];
  if (goalGap > 10) tips.push(`You're ${goalGap}s from goal - focus on volume this week`);
  else if (goalGap > 5) tips.push(`${goalGap}s to go - push race pace sets hard`);
  else if (goalGap > 0) tips.push(`Only ${goalGap}s away - you're almost there!`);
  else tips.push('Goal achieved! Focus on consistency and form');
  
  if (consistency < 50) tips.push('Consistency is your biggest limiter - show up every day');
  if (bestTime) tips.push(`Current best: ${formatTime(bestTime)} → Target: ${formatTime(goal.target_seconds)}`);
  
  return {
    weekFocus: `${stroke} ${distance}m - ${intensity}`,
    focusAreas: focusAreas.slice(0, 4),
    intensity,
    intensityDesc,
    goalGap: goalGap > 0 ? `${goalGap}s to drop` : 'Goal achieved!',
    workouts,
    totalWeeklyDistance: workouts.reduce((a, w) => a + parseInt(w.totalDistance), 0) + 'm',
    sessionsPerWeek: workouts.length,
    tips,
    adaptedFrom: { goalGap, focus, consistency, bestTime, targetTime: goal.target_seconds }
  };
}

function generateDistanceWorkouts(stroke, distance, goalGap, focus, intensity) {
  const workouts = [];
  
  // ===== SPRINT EVENTS (50m) =====
  if (distance === 50) {
    // Day 1: Explosive power
    workouts.push({
      day: 'Monday',
      type: 'Power & Speed',
      warmup: '300m easy choice',
      main: [
        { set: `12x25m ${stroke} FAST`, rest: '30s', focus: 'Maximum speed' },
        { set: '8x15m sprint from dive', rest: '45s', focus: 'Explosive start' },
        { set: `4x50m ${stroke} race pace`, rest: '90s', focus: 'Full race simulation' }
      ],
      cooldown: '200m easy',
      totalDistance: '1100m',
      focus: 'Sprint power'
    });
    
    // Day 2: Technique under fatigue
    workouts.push({
      day: 'Wednesday', 
      type: 'Speed Endurance',
      warmup: '400m with drills',
      main: [
        { set: `6x50m ${stroke} descend 1-3`, rest: '40s', focus: 'Build speed' },
        { set: `8x25m ${stroke} drill/swim by 25`, rest: '20s', focus: focus },
        { set: '4x25m underwater kick', rest: '30s', focus: 'Underwaters' }
      ],
      cooldown: '200m easy',
      totalDistance: '1200m',
      focus: 'Speed + technique'
    });
    
    // Day 3: Race day simulation
    workouts.push({
      day: 'Friday',
      type: 'Race Simulation',
      warmup: '300m race warmup routine',
      main: [
        { set: `6x50m ${stroke} @ race pace`, rest: '2min', focus: 'Goal time practice' },
        { set: '4x25m dive starts', rest: '60s', focus: 'Race start' },
        { set: `2x50m ${stroke} ALL OUT`, rest: '3min', focus: 'Time trial' }
      ],
      cooldown: '200m easy',
      totalDistance: '1000m',
      focus: 'Race preparation'
    });
  }
  
  // ===== MIDDLE DISTANCE (100m) =====
  else if (distance === 100) {
    // Day 1: Speed + turns
    workouts.push({
      day: 'Monday',
      type: 'Speed & Turns',
      warmup: '400m easy mix',
      main: [
        { set: `8x50m ${stroke} fast`, rest: '30s', focus: 'Hold speed' },
        { set: '8x25m turn practice', rest: '20s', focus: 'Fast turns' },
        { set: `4x100m ${stroke} negative split`, rest: '60s', focus: 'Build second 50' }
      ],
      cooldown: '200m easy',
      totalDistance: '1600m',
      focus: 'Speed maintenance'
    });
    
    // Day 2: Threshold
    workouts.push({
      day: 'Wednesday',
      type: 'Threshold',
      warmup: '300m with drills',
      main: [
        { set: `6x100m ${stroke} @ threshold`, rest: '20s', focus: 'Aerobic capacity' },
        { set: `8x50m ${stroke} drill/swim`, rest: '15s', focus: focus },
        { set: `4x75m ${stroke} descend`, rest: '30s', focus: 'Build speed' }
      ],
      cooldown: '200m easy',
      totalDistance: '1700m',
      focus: 'Lactate threshold'
    });
    
    // Day 3: Race pace
    workouts.push({
      day: 'Friday',
      type: 'Race Pace',
      warmup: '400m race warmup',
      main: [
        { set: `3x100m ${stroke} @ goal pace`, rest: '2min', focus: `Target: ${formatTime(Math.round(100 * (goalGap > 0 ? 1 : 0.98)))}` },
        { set: '6x50m build to race pace', rest: '40s', focus: 'Pace control' },
        { set: `2x100m ${stroke} TIME TRIAL`, rest: '3min', focus: 'Race simulation' }
      ],
      cooldown: '200m easy',
      totalDistance: '1500m',
      focus: 'Race execution'
    });
  }
  
  // ===== DISTANCE EVENTS (200m+) =====
  else {
    const reps = distance === 200 ? 4 : distance === 400 ? 3 : 2;
    
    // Day 1: Endurance base
    workouts.push({
      day: 'Monday',
      type: 'Endurance',
      warmup: '500m easy mix',
      main: [
        { set: `${reps}x${distance}m ${stroke} steady`, rest: '30s', focus: 'Aerobic base' },
        { set: `8x50m ${stroke} drill`, rest: '15s', focus: focus },
        { set: '4x100m kick', rest: '20s', focus: 'Leg endurance' }
      ],
      cooldown: '300m easy',
      totalDistance: `${(reps * distance) + 1200}m`,
      focus: 'Build endurance'
    });
    
    // Day 2: Negative split training
    workouts.push({
      day: 'Wednesday',
      type: 'Pacing',
      warmup: '400m with drills',
      main: [
        { set: `${reps + 2}x${Math.round(distance/2)}m ${stroke} negative split`, rest: '25s', focus: 'Second half faster' },
        { set: `6x100m ${stroke} descend 1-3`, rest: '20s', focus: 'Build through set' },
        { set: `4x50m ${stroke} FAST`, rest: '30s', focus: 'Speed reminder' }
      ],
      cooldown: '300m easy',
      totalDistance: `${((reps + 2) * distance/2) + 1100}m`,
      focus: 'Negative splitting'
    });
    
    // Day 3: Race simulation
    workouts.push({
      day: 'Friday',
      type: 'Race Pace',
      warmup: '500m race warmup',
      main: [
        { set: `2x${distance}m ${stroke} @ goal pace`, rest: '3min', focus: 'Race simulation' },
        { set: `4x${Math.round(distance/4)}m @ faster than race pace`, rest: '45s', focus: 'Speed reserve' },
        { set: `1x${distance}m TIME TRIAL`, rest: '-', focus: 'Full race effort' }
      ],
      cooldown: '300m easy',
      totalDistance: `${(3 * distance) + distance + 800}m`,
      focus: 'Race execution'
    });
    
    // Day 4: Recovery + technique (for distance events)
    if (intensity !== 'maintenance') {
      workouts.push({
        day: 'Saturday',
        type: 'Recovery',
        warmup: '400m easy',
        main: [
          { set: `8x50m ${stroke} drill focus`, rest: '20s', focus: focus },
          { set: '200m kick easy', rest: '-', focus: 'Active recovery' },
          { set: '4x100m choice stroke easy', rest: '15s', focus: 'Loosen up' }
        ],
        cooldown: '200m easy',
        totalDistance: '1400m',
        focus: 'Recovery & technique'
      });
    }
  }
  
  // Add extra session if high intensity and good consistency
  if (intensity === 'high' && workouts.length < 4) {
    workouts.push({
      day: 'Saturday',
      type: 'Technique',
      warmup: '300m easy',
      main: [
        { set: `10x50m ${stroke} drill focus`, rest: '20s', focus: focus },
        { set: '4x100m IM', rest: '20s', focus: 'All-around' }
      ],
      cooldown: '200m easy',
      totalDistance: '1200m',
      focus: 'Technical refinement'
    });
  }
  
  return workouts;
}

function formatTime(s) { 
  if (!s) return '-';
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; 
}

app.post('/api/times', async (req, res) => {
  const { swimmerId, stroke, distance, minutes, seconds } = req.body;
  const v = validateTimeInput(stroke, distance, minutes, seconds);
  if (!v.valid) return res.status(400).json({ error: v.errors.join(', ') });
  const today = new Date().toISOString().split('T')[0];
  const { data: ex } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', parseInt(distance)).eq('date', today).eq('time_seconds', v.totalSeconds);
  if (ex?.length) return res.status(400).json({ error: 'Duplicate' });
  const { data, error } = await supabase.from('swim_times').insert({ swimmer_id: swimmerId, stroke, distance: parseInt(distance), time_seconds: v.totalSeconds }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, time: data });
});

app.get('/api/times/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ times: data });
});

app.post('/api/goals', async (req, res) => {
  const { swimmerId, stroke, distance, targetMinutes, targetSeconds } = req.body;
  const target = (parseInt(targetMinutes) * 60) + parseInt(targetSeconds);
  const month = new Date().toISOString().slice(0, 7);
  const { data: ex } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId).eq('stroke', stroke).eq('distance', distance).eq('month', month).single();
  let data, error;
  if (ex) ({ data, error } = await supabase.from('goals').update({ target_seconds: target }).eq('id', ex.id).select().single());
  else ({ data, error } = await supabase.from('goals').insert({ swimmer_id: swimmerId, stroke, distance, target_seconds: target, month }).select().single());
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, goal: data });
});

app.get('/api/goals/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', new Date().toISOString().slice(0, 7)).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ goals: data });
});

app.get('/api/progress/:swimmerId', async (req, res) => {
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
});

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
    res.json({ success: true, feedback: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/video/feedback/:swimmerId', async (req, res) => {
  const { data, error } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ feedbacks: data });
});

app.get('/api/race-plan/:swimmerId', async (req, res) => {
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
