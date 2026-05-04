const { generateDistanceWorkouts } = require('../workouts');
const { formatTime } = require('./utils');

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
  return {
    weekFocus: `${stroke} ${distance}m - ${intensity}`,
    focusAreas: focusAreas.slice(0, 4),
    intensity,
    goalGap: goalGap > 0 ? `${goalGap}s to drop` : 'Goal achieved!',
    workouts,
    totalWeeklyDistance: workouts.reduce((a, w) => a + parseInt(w.totalDistance), 0) + 'm',
    sessionsPerWeek: workouts.length,
    tips
  };
}

module.exports = { generatePlan };
