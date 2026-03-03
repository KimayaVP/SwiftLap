require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Health check
app.get('/api/health', async (req, res) => {
  const { data, error } = await supabase.auth.getSession();
  res.json({
    status: 'ok',
    database: 'connected',
    timestamp: new Date().toISOString()
  });
});

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body;
  
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password
  });
  
  if (authError) {
    return res.status(400).json({ error: authError.message });
  }
  
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: authData.user.id,
      email,
      name,
      role: role || 'swimmer'
    })
    .select()
    .single();
  
  if (profileError) {
    return res.status(400).json({ error: profileError.message });
  }
  
  res.json({ success: true, user: profile });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();
  
  res.json({ 
    success: true, 
    user: profile,
    session: data.session
  });
});

// Get current user profile
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  
  res.json({ user: profile });
});

// Coach: Add swimmer
app.post('/api/coach/add-swimmer', async (req, res) => {
  const { email, password, name, coachId } = req.body;
  
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password
  });
  
  if (authError) {
    return res.status(400).json({ error: authError.message });
  }
  
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: authData.user.id,
      email,
      name,
      role: 'swimmer',
      coach_id: coachId
    })
    .select()
    .single();
  
  if (profileError) {
    return res.status(400).json({ error: profileError.message });
  }
  
  res.json({ success: true, swimmer: profile });
});

// Coach: Get swimmers
app.get('/api/coach/swimmers/:coachId', async (req, res) => {
  const { coachId } = req.params;
  
  const { data: swimmers, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('coach_id', coachId);
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  res.json({ swimmers });
});

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health\n`);
});
