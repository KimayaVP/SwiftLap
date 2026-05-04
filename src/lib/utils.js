// Generic utilities with no DB dependency.

function formatTime(s) {
  if (!s) return '-';
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function getWeekStart(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

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

module.exports = { formatTime, getWeekStart, generateInviteCode, validateTimeInput };
