// Workout generator that varies by distance AND intensity

function generateDistanceWorkouts(stroke, distance, goalGap, focus, intensity) {
  const workouts = [];
  
  // ===== 50m SPRINTS =====
  if (distance === 50) {
    if (intensity === 'high') {
      // FAR FROM GOAL: Build speed endurance
      workouts.push({ day: 'Monday', type: 'Speed Endurance', warmup: '400m easy', main: [
        { set: `16x25m ${stroke} FAST`, rest: '25s', focus: 'Max speed' },
        { set: '8x50m kick', rest: '20s', focus: 'Leg power' }
      ], cooldown: '300m easy', totalDistance: '1500m', focus: 'Build sprint base' });
      workouts.push({ day: 'Wednesday', type: 'Power', warmup: '400m drill', main: [
        { set: `10x50m ${stroke} descend`, rest: '45s', focus: 'Build speed' },
        { set: '6x25m dive starts', rest: '60s', focus: 'Explosive starts' }
      ], cooldown: '300m easy', totalDistance: '1350m', focus: 'Power development' });
      workouts.push({ day: 'Friday', type: 'Threshold', warmup: '300m easy', main: [
        { set: `8x50m ${stroke} @ 80%`, rest: '30s', focus: 'Hold pace' },
        { set: `4x100m ${stroke}`, rest: '20s', focus: 'Endurance' }
      ], cooldown: '200m easy', totalDistance: '1300m', focus: 'Aerobic base' });
      workouts.push({ day: 'Saturday', type: 'Volume', warmup: '500m easy', main: [
        { set: `12x50m ${stroke} steady`, rest: '20s', focus: 'Volume' }
      ], cooldown: '300m easy', totalDistance: '1400m', focus: 'Build base' });
    } else if (intensity === 'moderate') {
      // CLOSE TO GOAL: Race pace focus
      workouts.push({ day: 'Monday', type: 'Race Prep', warmup: '300m easy', main: [
        { set: `8x25m ${stroke} RACE PACE`, rest: '40s', focus: 'Goal speed' },
        { set: '4x50m build', rest: '30s', focus: 'Acceleration' }
      ], cooldown: '200m easy', totalDistance: '900m', focus: 'Race simulation' });
      workouts.push({ day: 'Wednesday', type: 'Speed', warmup: '300m drill', main: [
        { set: `6x50m ${stroke} @ race pace`, rest: '90s', focus: 'Target time' },
        { set: '4x25m SPRINT', rest: '45s', focus: 'Top speed' }
      ], cooldown: '200m easy', totalDistance: '900m', focus: 'Speed work' });
      workouts.push({ day: 'Friday', type: 'Time Trial', warmup: '400m race warmup', main: [
        { set: `4x50m ${stroke} ALL OUT`, rest: '3min', focus: 'Race simulation' }
      ], cooldown: '200m easy', totalDistance: '800m', focus: 'Race practice' });
    } else {
      // GOAL ACHIEVED: Maintain with technique
      workouts.push({ day: 'Monday', type: 'Technique', warmup: '300m easy', main: [
        { set: `8x25m ${stroke} drill`, rest: '20s', focus: focus },
        { set: '4x50m smooth', rest: '30s', focus: 'Form' }
      ], cooldown: '200m easy', totalDistance: '700m', focus: 'Perfect technique' });
      workouts.push({ day: 'Wednesday', type: 'Easy Speed', warmup: '300m easy', main: [
        { set: `4x50m ${stroke} @ 90%`, rest: '60s', focus: 'Stay sharp' }
      ], cooldown: '200m easy', totalDistance: '700m', focus: 'Maintenance' });
      workouts.push({ day: 'Friday', type: 'Recovery', warmup: '400m choice', main: [
        { set: '6x50m IM order', rest: '20s', focus: 'Variety' }
      ], cooldown: '200m easy', totalDistance: '900m', focus: 'Active recovery' });
    }
  }
  
  // ===== 100m MIDDLE DISTANCE =====
  else if (distance === 100) {
    if (intensity === 'high') {
      // FAR FROM GOAL: Build aerobic base + speed
      workouts.push({ day: 'Monday', type: 'Endurance', warmup: '500m easy', main: [
        { set: `8x100m ${stroke}`, rest: '20s', focus: 'Aerobic base' },
        { set: '8x50m kick', rest: '15s', focus: 'Leg endurance' }
      ], cooldown: '300m easy', totalDistance: '2000m', focus: 'Build base' });
      workouts.push({ day: 'Wednesday', type: 'Threshold', warmup: '400m drill', main: [
        { set: `6x100m ${stroke} descend`, rest: '25s', focus: 'Build speed' },
        { set: `8x50m ${stroke} fast`, rest: '20s', focus: 'Speed' }
      ], cooldown: '300m easy', totalDistance: '1700m', focus: 'Lactate threshold' });
      workouts.push({ day: 'Friday', type: 'Speed', warmup: '400m easy', main: [
        { set: `12x50m ${stroke} FAST`, rest: '30s', focus: 'Raw speed' },
        { set: '8x25m sprint', rest: '25s', focus: 'Max effort' }
      ], cooldown: '300m easy', totalDistance: '1500m', focus: 'Speed development' });
      workouts.push({ day: 'Saturday', type: 'Volume', warmup: '500m easy', main: [
        { set: `10x100m ${stroke} steady`, rest: '15s', focus: 'Volume' }
      ], cooldown: '400m easy', totalDistance: '1900m', focus: 'Endurance base' });
    } else if (intensity === 'moderate') {
      // CLOSE TO GOAL: Race pace + turns
      workouts.push({ day: 'Monday', type: 'Race Pace', warmup: '400m easy', main: [
        { set: `6x100m ${stroke} @ goal pace`, rest: '90s', focus: 'Target: ${Math.round(goalGap)}s to drop' },
        { set: '6x50m negative split', rest: '30s', focus: 'Second 50 faster' }
      ], cooldown: '200m easy', totalDistance: '1400m', focus: 'Goal pace' });
      workouts.push({ day: 'Wednesday', type: 'Turns & Speed', warmup: '300m drill', main: [
        { set: '8x25m turn practice', rest: '20s', focus: 'Fast turns' },
        { set: `4x100m ${stroke} race pace`, rest: '2min', focus: 'Full race' }
      ], cooldown: '200m easy', totalDistance: '1100m', focus: 'Race skills' });
      workouts.push({ day: 'Friday', type: 'Time Trial', warmup: '400m race warmup', main: [
        { set: `3x100m ${stroke} ALL OUT`, rest: '4min', focus: 'Beat your best' }
      ], cooldown: '300m easy', totalDistance: '1000m', focus: 'Race simulation' });
    } else {
      // GOAL ACHIEVED: Maintain fitness
      workouts.push({ day: 'Monday', type: 'Technique', warmup: '400m easy', main: [
        { set: `6x100m ${stroke} drill/swim`, rest: '20s', focus: focus },
        { set: '4x50m choice', rest: '20s', focus: 'Easy' }
      ], cooldown: '200m easy', totalDistance: '1200m', focus: 'Form focus' });
      workouts.push({ day: 'Wednesday', type: 'Easy', warmup: '300m easy', main: [
        { set: `4x100m ${stroke} relaxed`, rest: '30s', focus: 'Smooth' }
      ], cooldown: '200m easy', totalDistance: '900m', focus: 'Stay loose' });
      workouts.push({ day: 'Friday', type: 'Mixed', warmup: '400m IM', main: [
        { set: '4x100m choice stroke', rest: '25s', focus: 'Variety' }
      ], cooldown: '200m easy', totalDistance: '1000m', focus: 'Have fun' });
    }
  }
  
  // ===== 200m+ DISTANCE =====
  else {
    const reps = distance === 200 ? 4 : 3;
    if (intensity === 'high') {
      // FAR FROM GOAL: Heavy endurance
      workouts.push({ day: 'Monday', type: 'Endurance', warmup: '600m easy', main: [
        { set: `${reps + 2}x${distance}m ${stroke}`, rest: '30s', focus: 'Aerobic power' },
        { set: '6x100m kick', rest: '20s', focus: 'Leg stamina' }
      ], cooldown: '400m easy', totalDistance: `${(reps + 2) * distance + 1600}m`, focus: 'Build endurance' });
      workouts.push({ day: 'Wednesday', type: 'Threshold', warmup: '500m drill', main: [
        { set: `8x${distance/2}m ${stroke} threshold`, rest: '20s', focus: 'Hold pace' },
        { set: `6x100m ${stroke} descend`, rest: '15s', focus: 'Build' }
      ], cooldown: '400m easy', totalDistance: `${4 * distance + 1500}m`, focus: 'Lactate work' });
      workouts.push({ day: 'Friday', type: 'Negative Split', warmup: '500m easy', main: [
        { set: `${reps}x${distance}m negative split`, rest: '45s', focus: 'Second half faster' },
        { set: '4x50m FAST', rest: '30s', focus: 'Speed reminder' }
      ], cooldown: '400m easy', totalDistance: `${reps * distance + 1100}m`, focus: 'Pacing' });
      workouts.push({ day: 'Saturday', type: 'Long Swim', warmup: '400m easy', main: [
        { set: `1x${distance * 2}m ${stroke} continuous`, rest: '-', focus: 'Mental toughness' }
      ], cooldown: '400m easy', totalDistance: `${distance * 2 + 800}m`, focus: 'Endurance' });
    } else if (intensity === 'moderate') {
      // CLOSE TO GOAL: Race pace work
      workouts.push({ day: 'Monday', type: 'Race Pace', warmup: '500m easy', main: [
        { set: `${reps}x${distance}m @ goal pace`, rest: '2min', focus: 'Target time' },
        { set: `4x${distance/4}m FAST`, rest: '30s', focus: 'Speed reserve' }
      ], cooldown: '300m easy', totalDistance: `${reps * distance + distance + 800}m`, focus: 'Goal pace' });
      workouts.push({ day: 'Wednesday', type: 'Broken Swims', warmup: '400m drill', main: [
        { set: `3x(${distance}m broken: ${distance/4}m x4 @10s rest)`, rest: '3min', focus: 'Race simulation' }
      ], cooldown: '300m easy', totalDistance: `${3 * distance + 700}m`, focus: 'Race practice' });
      workouts.push({ day: 'Friday', type: 'Time Trial', warmup: '500m race warmup', main: [
        { set: `2x${distance}m ALL OUT`, rest: '5min', focus: 'Beat your best' }
      ], cooldown: '400m easy', totalDistance: `${2 * distance + 900}m`, focus: 'Race effort' });
    } else {
      // GOAL ACHIEVED: Easy maintenance
      workouts.push({ day: 'Monday', type: 'Easy', warmup: '500m easy', main: [
        { set: `3x${distance}m ${stroke} relaxed`, rest: '30s', focus: 'Smooth strokes' }
      ], cooldown: '300m easy', totalDistance: `${3 * distance + 800}m`, focus: 'Stay fit' });
      workouts.push({ day: 'Wednesday', type: 'Drill', warmup: '400m easy', main: [
        { set: `8x50m ${stroke} drill`, rest: '15s', focus: focus },
        { set: '4x100m choice', rest: '20s', focus: 'Variety' }
      ], cooldown: '300m easy', totalDistance: '1500m', focus: 'Technique' });
      workouts.push({ day: 'Friday', type: 'Fun', warmup: '400m choice', main: [
        { set: '400m IM', rest: '-', focus: 'All strokes' },
        { set: '4x100m easy', rest: '20s', focus: 'Enjoy' }
      ], cooldown: '200m easy', totalDistance: '1400m', focus: 'Active recovery' });
    }
  }
  
  return workouts;
}

module.exports = { generateDistanceWorkouts };
