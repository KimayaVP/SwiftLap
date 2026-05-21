const { supabase } = require('../db');

// Seed demo data so a new swimmer's dashboard isn't empty on first login.
// Tagged source='demo' and auto-cleared on the first real workout (see watch route).
async function seedDemoData(swimmerId) {
  const now = new Date();
  const lapCount = 60;
  const lapTimeSeconds = 30;
  await supabase.from('watch_workouts').insert({
    swimmer_id: swimmerId,
    duration: 1800,
    distance: 1500,
    laps: lapCount,
    stroke_count: lapCount * 15,
    avg_heart_rate: 145,
    calories: 420,
    lap_times: Array(lapCount).fill(lapTimeSeconds),
    lap_strokes: Array(lapCount).fill(15),
    fatigue_level: 'Moderate 😊',
    pool_length: 25,
    workout_date: now.toISOString(),
    source: 'demo'
  });
  await supabase.from('goals').insert({
    swimmer_id: swimmerId,
    stroke: 'Freestyle',
    distance: 100,
    target_seconds: 90,
    month: now.toISOString().slice(0, 7),
    source: 'demo'
  });
  await supabase.from('swim_times').insert({
    swimmer_id: swimmerId,
    stroke: 'Freestyle',
    distance: 100,
    time_seconds: 98,
    date: now.toISOString().split('T')[0],
    source: 'demo'
  });
}

module.exports = { seedDemoData };
