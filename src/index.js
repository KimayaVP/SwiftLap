require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { generateDistanceWorkouts } = require("./workouts");
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// ========== BADGE DEFINITIONS ==========
const BADGES = {
  first_swim: { id: 'first_swim', name: 'First Splash', icon: '🏊', desc: 'Log your first time' },
  five_sessions: { id: 'five_sessions', name: 'Getting Serious', icon: '💪', desc: 'Log 5 sessions' },
  ten_sessions: { id: 'ten_sessions', name: 'Dedicated', icon: '🔥', desc: 'Log 10 sessions' },
  twenty_five_sessions: { id: 'twenty_five_sessions', name: 'Machine', icon: '🤖', desc: 'Log 25 sessions' },
  first_goal: { id: 'first_goal', name: 'Goal Setter', icon: '🎯', desc: 'Set your first goal' },
  goal_crusher: { id: 'goal_crusher', name: 'Goal Crusher', icon: '🏆', desc: 'Achieve a goal' },
  three_goals: { id: 'three_goals', name: 'Triple Threat', icon: '🥇', desc: 'Achieve 3 goals' },
  first_video: { id: 'first_video', name: 'Camera Ready', icon: '🎥', desc: 'Upload first video' },
  streak_3: { id: 'streak_3', name: 'On Fire', icon: '🔥', desc: '3-day streak' },
  streak_7: { id: 'streak_7', name: 'Week Warrior', icon: '⚡', desc: '7-day streak' },
  streak_14: { id: 'streak_14', name: 'Unstoppable', icon: '🚀', desc: '14-day streak' },
  streak_30: { id: 'streak_30', name: 'Legend', icon: '👑', desc: '30-day streak' },
  early_bird: { id: 'early_bird', name: 'Early Bird', icon: '🌅', desc: 'Log before 7am' },
  night_owl: { id: 'night_owl', name: 'Night Owl', icon: '🦉', desc: 'Log after 9pm' },
  all_strokes: { id: 'all_strokes', name: 'Versatile', icon: '🌊', desc: 'Log all 5 strokes' },
  improvement_5: { id: 'improvement_5', name: 'Speeding Up', icon: '⏱️', desc: 'Improve by 5+ seconds' },
  top_rank: { id: 'top_rank', name: 'Top Dog', icon: '🥇', desc: 'Reach #1 on leaderboard' }
};

// ========== ERROR & ANALYTICS ==========
const logError = async (error, context = {}) => {
  console.error(`[ERROR] ${new Date().toISOString()}:`, error.message, context);
  try { await supabase.from('analytics').insert({ user_id: context.userId || null, event_type: 'error', event_data: { message: error.message, context } }); } catch (e) {}
};

const trackEvent = async (userId, eventType, eventData = {}) => {
  try { await supabase.from('analytics').insert({ user_id: userId, event_type: eventType, event_data: eventData }); } catch (e) {}
};

// ========== ACHIEVEMENT SYSTEM ==========
async function checkAndAwardBadges(swimmerId) {
  const newBadges = [];
  const { data: existing } = await supabase.from('achievements').select('badge_id').eq('swimmer_id', swimmerId);
  const earned = new Set((existing || []).map(a => a.badge_id));
  
  const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
  const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId);
  const { data: videos } = await supabase.from('video_feedback').select('*').eq('swimmer_id', swimmerId);
  const { data: streak } = await supabase.from('streaks').select('*').eq('swimmer_id', swimmerId).single();
  
  const timeCount = times?.length || 0;
  const goalCount = goals?.length || 0;
  const videoCount = videos?.length || 0;
  const currentStreak = streak?.current_streak || 0;
  
  // Session badges
  if (timeCount >= 1 && !earned.has('first_swim')) newBadges.push('first_swim');
  if (timeCount >= 5 && !earned.has('five_sessions')) newBadges.push('five_sessions');
  if (timeCount >= 10 && !earned.has('ten_sessions')) newBadges.push('ten_sessions');
  if (timeCount >= 25 && !earned.has('twenty_five_sessions')) newBadges.push('twenty_five_sessions');
  
  // Goal badges
  if (goalCount >= 1 && !earned.has('first_goal')) newBadges.push('first_goal');
  
  // Check goal achievements
  let goalsAchieved = 0;
  for (const goal of (goals || [])) {
    const relevantTimes = (times || []).filter(t => t.stroke === goal.stroke && t.distance === goal.distance);
    if (relevantTimes.length > 0) {
      const best = Math.min(...relevantTimes.map(t => t.time_seconds));
      if (best <= goal.target_seconds) goalsAchieved++;
    }
  }
  if (goalsAchieved >= 1 && !earned.has('goal_crusher')) newBadges.push('goal_crusher');
  if (goalsAchieved >= 3 && !earned.has('three_goals')) newBadges.push('three_goals');
  
  // Video badge
  if (videoCount >= 1 && !earned.has('first_video')) newBadges.push('first_video');
  
  // Streak badges
  if (currentStreak >= 3 && !earned.has('streak_3')) newBadges.push('streak_3');
  if (currentStreak >= 7 && !earned.has('streak_7')) newBadges.push('streak_7');
  if (currentStreak >= 14 && !earned.has('streak_14')) newBadges.push('streak_14');
  if (currentStreak >= 30 && !earned.has('streak_30')) newBadges.push('streak_30');
  
  // All strokes badge
  const strokes = new Set((times || []).map(t => t.stroke));
  if (strokes.size >= 5 && !earned.has('all_strokes')) newBadges.push('all_strokes');
  
  // Improvement badge
  const strokeDistances = {};
  (times || []).forEach(t => {
    const key = `${t.stroke}-${t.distance}`;
    if (!strokeDistances[key]) strokeDistances[key] = [];
    strokeDistances[key].push({ time: t.time_seconds, date: t.created_at });
  });
  for (const [key, entries] of Object.entries(strokeDistances)) {
    if (entries.length >= 2) {
      entries.sort((a, b) => new Date(a.date) - new Date(b.date));
      const first = entries[0].time;
      const best = Math.min(...entries.map(e => e.time));
      if (first - best >= 5 && !earned.has('improvement_5')) newBadges.push('improvement_5');
    }
  }
  
  // Award new badges
  for (const badgeId of newBadges) {
    await supabase.from('achievements').insert({ swimmer_id: swimmerId, badge_id: badgeId });
    await trackEvent(swimmerId, 'badge_earned', { badge: badgeId });
  }
  
  return newBadges.map(id => BADGES[id]);
}

async function updateStreak(swimmerId) {
  const today = new Date().toISOString().split('T')[0];
  const { data: streak } = await supabase.from('streaks').select('*').eq('swimmer_id', swimmerId).single();
  
  if (!streak) {
    await supabase.from('streaks').insert({ swimmer_id: swimmerId, current_streak: 1, longest_streak: 1, last_activity_date: today });
    return { current: 1, longest: 1, isNew: true };
  }
  
  const lastDate = streak.last_activity_date;
  if (lastDate === today) return { current: streak.current_streak, longest: streak.longest_streak, isNew: false };
  
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  let newStreak = lastDate === yesterday ? streak.current_streak + 1 : 1;
  let longest = Math.max(streak.longest_streak, newStreak);
  
  await supabase.from('streaks').update({ current_streak: newStreak, longest_streak: longest, last_activity_date: today }).eq('swimmer_id', swimmerId);
  
  return { current: newStreak, longest, isNew: true };
}

// ========== WEEKLY CHALLENGES ==========
function getWeeklyChallenge() {
  const challenges = [
    { id: 'log_5', name: 'Consistency Week', desc: 'Log 5 sessions this week', target: 5, type: 'sessions' },
    { id: 'improve_2', name: 'Speed Demon', desc: 'Improve any time by 2+ seconds', target: 2, type: 'improvement' },
    { id: 'all_strokes', name: 'Stroke Explorer', desc: 'Log at least 3 different strokes', target: 3, type: 'strokes' },
    { id: 'volume_3000', name: 'Distance Challenge', desc: 'Log 3000m+ total this week', target: 3000, type: 'distance' }
  ];
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return challenges[weekNum % challenges.length];
}

async function checkChallengeProgress(swimmerId) {
  const challenge = getWeeklyChallenge();
  const weekStart = getWeekStart(new Date());
  const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId).gte('date', weekStart);
  
  let progress = 0;
  if (challenge.type === 'sessions') progress = times?.length || 0;
  else if (challenge.type === 'strokes') progress = new Set((times || []).map(t => t.stroke)).size;
  else if (challenge.type === 'distance') progress = (times || []).reduce((sum, t) => sum + t.distance, 0);
  
  return { ...challenge, progress, completed: progress >= challenge.target };
}

// ========== ACHIEVEMENTS API ==========
app.get('/api/achievements/:swimmerId', async (req, res) => {
  try {
    const swimmerId = req.params.swimmerId;
    const { data: achievements } = await supabase.from('achievements').select('*').eq('swimmer_id', swimmerId).order('unlocked_at', { ascending: false });
    const { data: streak } = await supabase.from('streaks').select('*').eq('swimmer_id', swimmerId).single();
    const challenge = await checkChallengeProgress(swimmerId);
    
    const earnedBadges = (achievements || []).map(a => ({ ...BADGES[a.badge_id], unlocked_at: a.unlocked_at }));
    const allBadges = Object.values(BADGES).map(b => ({ ...b, earned: earnedBadges.some(e => e.id === b.id) }));
    
    res.json({
      earned: earnedBadges,
      all: allBadges,
      streak: streak || { current_streak: 0, longest_streak: 0 },
      challenge
    });
  } catch (e) { await logError(e, { route: 'achievements' }); res.status(500).json({ error: e.message }); }
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

app.post('/api/analytics/track', async (req, res) => {
  const { userId, eventType, eventData } = req.body;
  await trackEvent(userId, eventType, eventData);
  res.json({ success: true });
});

app.get('/api/analytics/summary', async (req, res) => {
  try {
    const { data: events } = await supabase.from('analytics').select('*').order('created_at', { ascending: false }).limit(100);
    const summary = { totalEvents: events?.length || 0, byType: {}, recentErrors: [] };
    (events || []).forEach(e => { summary.byType[e.event_type] = (summary.byType[e.event_type] || 0) + 1; });
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const { data: plans } = await supabase.from('training_plans').select('*').in('swimmer_id', ids).order('created_at', { ascending: false });
    const { data: streaks } = await supabase.from('streaks').select('*').in('swimmer_id', ids);
    const { data: achievements } = await supabase.from('achievements').select('*').in('swimmer_id', ids);
    
    const swimmerData = swimmers.map(s => {
      const sg = (goals || []).filter(g => g.swimmer_id === s.id);
      const st = (times || []).filter(t => t.swimmer_id === s.id);
      const sp = (plans || []).find(p => p.swimmer_id === s.id);
      const ss = (streaks || []).find(x => x.swimmer_id === s.id);
      const sa = (achievements || []).filter(a => a.swimmer_id === s.id);
      let status = 'no_goals', goalsAhead = 0, goalsBehind = 0;
      sg.forEach(g => {
        const rt = st.filter(t => t.stroke === g.stroke && t.distance === g.distance);
        if (rt.length) {
          const best = Math.min(...rt.map(t => t.time_seconds));
          if (best <= g.target_seconds) goalsAhead++; else goalsBehind++;
        }
      });
      if (sg.length) status = goalsBehind > 0 ? 'behind' : 'ahead';
      return { ...s, goalsCount: sg.length, goalsAhead, goalsBehind, sessionsThisMonth: st.length, status, currentPlan: sp || null, streak: ss?.current_streak || 0, badges: sa.length };
    });
    const summary = { total: swimmers.length, ahead: swimmerData.filter(s => s.status === 'ahead').length, behind: swimmerData.filter(s => s.status === 'behind').length, noGoals: swimmerData.filter(s => s.status === 'no_goals').length };
    await trackEvent(coachId, 'dashboard_view', {});
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
    
    // Check for #1 badge
    if (lb.length > 0 && lb[0].id) {
      const { data: existing } = await supabase.from('achievements').select('*').eq('swimmer_id', lb[0].id).eq('badge_id', 'top_rank');
      if (!existing?.length) {
        await supabase.from('achievements').insert({ swimmer_id: lb[0].id, badge_id: 'top_rank' });
      }
    }
    
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
      const shouldRegen = !old.goalStroke || old.goalStroke !== goal.stroke || old.goalDistance !== goal.distance || Math.abs((old.goalGap || 0) - goalGap) > 3;
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
  let intensity = goalGap > 5 ? 'high' : goalGap > 0 ? 'moderate' : 'maintenance';
  const focusAreas = [focus];
  if (goalGap > 5) focusAreas.push('Race pace', 'Threshold');
  else if (goalGap > 0) focusAreas.push('Speed', 'Race simulation');
  else focusAreas.push('Technique', 'Consistency');
  const workouts = generateDistanceWorkouts(stroke, distance, goalGap, focus, intensity);
  const tips = [];
  if (goalGap > 5) tips.push(`${goalGap}s to go - push hard`);
  else if (goalGap > 0) tips.push(`Only ${goalGap}s away!`);
  else tips.push('Goal achieved! Maintain form');
  if (bestTime) tips.push(`Best: ${formatTime(bestTime)} → Target: ${formatTime(goal.target_seconds)}`);
  return { weekFocus: `${stroke} ${distance}m - ${intensity}`, focusAreas: focusAreas.slice(0, 4), intensity, goalGap: goalGap > 0 ? `${goalGap}s to drop` : 'Goal achieved!', workouts, totalWeeklyDistance: workouts.reduce((a, w) => a + parseInt(w.totalDistance), 0) + 'm', sessionsPerWeek: workouts.length, tips };
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
    
    // Update streak and check badges
    const streakResult = await updateStreak(swimmerId);
    const newBadges = await checkAndAwardBadges(swimmerId);
    
    await trackEvent(swimmerId, 'time_logged', { stroke, distance, time: v.totalSeconds });
    res.json({ success: true, time: data, streak: streakResult, newBadges });
  } catch (e) { await logError(e, { route: 'times-post' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/times/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('swim_times').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ times: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    
    const newBadges = await checkAndAwardBadges(swimmerId);
    await trackEvent(swimmerId, 'goal_set', { stroke, distance, target });
    res.json({ success: true, goal: data, newBadges });
  } catch (e) { await logError(e, { route: 'goals-post' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/goals/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('goals').select('*').eq('swimmer_id', req.params.swimmerId).eq('month', new Date().toISOString().slice(0, 7)).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ goals: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    
    const newBadges = await checkAndAwardBadges(swimmerId);
    await trackEvent(swimmerId, 'video_uploaded', { stroke });
    res.json({ success: true, feedback: data, newBadges });
  } catch (e) { await logError(e, { route: 'video-upload' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/video/feedback/:swimmerId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('video_feedback').select('*').eq('swimmer_id', req.params.swimmerId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ feedbacks: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.json({ ready: true, goal: g, performance: { bestTime: best, gap }, trainingFocus: [feedbacks[0].feedback.priority_focus, gap > 5 ? 'Volume' : 'Race pace'], racePlan: { strategy: gap > 0 ? 'Conservative' : 'Even', splits: [{ segment: 'First half', target: Math.round(g.target_seconds * 0.52) + 's' }, { segment: 'Second half', target: Math.round(g.target_seconds * 0.48) + 's' }], targetTime: formatTime(g.target_seconds) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function genFeedback(stroke) {
  const t = {
    Freestyle: { body_position: 'Good', arm_technique: 'Strong', kick: 'Consistent', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Catch', 'Rotation', 'Kick'][Math.floor(Math.random() * 3)] },
    Backstroke: { body_position: 'Good', arm_technique: 'Clean', kick: 'Steady', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Hip rotation', 'Entry', 'Kick'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: 'Good', arm_technique: 'Strong', kick: 'Powerful', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Glide', 'Timing', 'Pullout'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: 'Good', arm_technique: 'Strong', kick: 'Two kicks', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Second kick', 'Hip drive', 'Breathing'][Math.floor(Math.random() * 3)] },
    IM: { transitions: 'Smooth', pacing: 'Good', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Turns', 'Pacing', 'Weakest stroke'][Math.floor(Math.random() * 3)] }
  };
  return t[stroke] || t.Freestyle;
}

app.listen(PORT, () => console.log(`\n🏊 SwiftLapLogic at http://localhost:${PORT}\n`));

// ========== COACH-SWIMMER APPROVAL FLOW ==========

// Search for coaches (for swimmers to find and request)
app.get('/api/coaches/search', async (req, res) => {
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
app.post('/api/requests/send', async (req, res) => {
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
app.get('/api/requests/incoming/:userId', async (req, res) => {
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
app.get('/api/requests/outgoing/:userId', async (req, res) => {
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
app.post('/api/requests/respond', async (req, res) => {
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
app.post('/api/requests/invite', async (req, res) => {
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
app.post('/api/requests/unlink', async (req, res) => {
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
