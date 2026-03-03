require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

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
    .select()
    .single();
  
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, user: profile });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();
  
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
    .select()
    .single();
  
  if (profileError) return res.status(400).json({ error: profileError.message });
  res.json({ success: true, swimmer: profile });
});

// Coach: Get swimmers
app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  const { data: swimmers, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('coach_id', req.params.coachId);
  
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
    .select()
    .single();
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, time: data });
});

// Get swim times for swimmer
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
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  
  // Upsert: update if exists, insert if not
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
    ({ data, error } = await supabase
      .from('goals')
      .update({ target_seconds: targetSecondsTotal })
      .eq('id', existing.id)
      .select()
      .single());
  } else {
    ({ data, error } = await supabase
      .from('goals')
      .insert({ swimmer_id: swimmerId, stroke, distance, target_seconds: targetSecondsTotal, month })
      .select()
      .single());
  }
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, goal: data });
});

// Get goals for swimmer
app.get('/api/goals/:swimmerId', async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('swimmer_id', req.params.swimmerId)
    .eq('month', month);
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ goals: data });
});

// Get progress (times vs goal)
app.get('/api/progress/:swimmerId', async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const swimmerId = req.params.swimmerId;
  
  // Get goals
  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('swimmer_id', swimmerId)
    .eq('month', month);
  
  // Get times this month
  const startOfMonth = `${month}-01`;
  const { data: times } = await supabase
    .from('swim_times')
    .select('*')
    .eq('swimmer_id', swimmerId)
    .gte('date', startOfMonth)
    .order('created_at', { ascending: false });
  
  // Calculate progress for each goal
  const progress = (goals || []).map(goal => {
    const relevantTimes = (times || []).filter(t => 
      t.stroke === goal.stroke && t.distance === goal.distance
    );
    
    const bestTime = relevantTimes.length > 0 
      ? Math.min(...relevantTimes.map(t => t.time_seconds))
      : null;
    
    const avgTime = relevantTimes.length > 0
      ? Math.round(relevantTimes.reduce((sum, t) => sum + t.time_seconds, 0) / relevantTimes.length)
      : null;
    
    const status = bestTime === null ? 'no_data' 
      : bestTime <= goal.target_seconds ? 'ahead' 
      : 'behind';
    
    const gap = bestTime ? bestTime - goal.target_seconds : null;
    
    return {
      goal,
      sessionsLogged: relevantTimes.length,
      bestTime,
      avgTime,
      status,
      gap
    };
  });
  
  res.json({ progress, times: times || [] });
});

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});
