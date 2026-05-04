const { supabase } = require('../db');
const { trackEvent } = require('./tracking');
const { getWeekStart } = require('./utils');

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

module.exports = { BADGES, checkAndAwardBadges, updateStreak, getWeeklyChallenge, checkChallengeProgress };
