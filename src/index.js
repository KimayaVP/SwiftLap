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

// Store swim times in memory (will move to DB next)
let swimTimes = [];

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Simple connection test using Supabase auth
    const { data, error } = await supabase.auth.getSession();
    
    res.json({
      status: 'ok',
      database: 'connected',
      supabaseUrl: process.env.SUPABASE_URL ? 'set' : 'missing',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      message: err.message
    });
  }
});

// API: Get all swim times
app.get('/api/times', (req, res) => {
  res.json(swimTimes);
});

// API: Log new swim time
app.post('/api/times', (req, res) => {
  const { stroke, distance, minutes, seconds, date } = req.body;
  
  const newTime = {
    id: Date.now(),
    stroke,
    distance,
    time: `${minutes}:${seconds.toString().padStart(2, '0')}`,
    totalSeconds: (parseInt(minutes) * 60) + parseInt(seconds),
    date: date || new Date().toISOString().split('T')[0]
  };
  
  swimTimes.unshift(newTime);
  console.log('✅ Logged:', newTime);
  res.json({ success: true, data: newTime });
});

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health\n`);
});
