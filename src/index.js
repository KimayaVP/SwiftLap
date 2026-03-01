const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Store swim times in memory (we'll add database later)
let swimTimes = [];

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

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
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});
