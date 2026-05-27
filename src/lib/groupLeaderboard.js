const { supabase } = require('../db');
const { createNotification } = require('./notifications');

// Compute a friend-group leaderboard: a composite score per member from recent
// activity, improvement, goal completion and streak. Returns members sorted
// best-first with a `rank` (1-based). Shared by the GET route and the overtake
// notification logic so the two never diverge.
async function computeGroupLeaderboard(groupId) {
  const { data: members } = await supabase
    .from('group_members')
    .select('swimmer_id, profiles(id, name)')
    .eq('group_id', groupId);
  if (!members?.length) return [];

  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const leaderboard = [];

  for (const m of members) {
    const swimmerId = m.swimmer_id;
    const name = m.profiles?.name || 'Swimmer';

    const { data: times } = await supabase.from('swim_times').select('*').eq('swimmer_id', swimmerId);
    const { data: goals } = await supabase.from('goals').select('*').eq('swimmer_id', swimmerId);
    const { data: streak } = await supabase.from('streaks').select('current_streak').eq('swimmer_id', swimmerId).single();

    const recentTimes = times?.filter(t => t.date >= d30) || [];
    const sessionsThisMonth = recentTimes.length;

    let improvementPct = 0;
    if (times?.length >= 2) {
      const sorted = [...times].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const first = sorted[0].time_seconds;
      const last = sorted[sorted.length - 1].time_seconds;
      improvementPct = Math.round(((first - last) / first) * 100);
    }

    let goalsAchieved = 0;
    for (const g of goals || []) {
      const best = times?.filter(t => t.stroke === g.stroke && t.distance === g.distance)
        .reduce((min, t) => Math.min(min, t.time_seconds), Infinity);
      if (best <= g.target_seconds) goalsAchieved++;
    }
    const goalRate = goals?.length ? Math.round((goalsAchieved / goals.length) * 100) : 0;

    const compositeScore = Math.round(
      (improvementPct * 0.4) +
      (goalRate * 0.3) +
      (Math.min(100, sessionsThisMonth * 10) * 0.2) +
      ((streak?.current_streak || 0) * 2 * 0.1)
    );

    leaderboard.push({ id: swimmerId, name, improvementPct, goalRate, sessionsThisMonth, streak: streak?.current_streak || 0, compositeScore });
  }

  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  leaderboard.forEach((s, i) => s.rank = i + 1);
  return leaderboard;
}

// Recompute every group the given swimmer is in, and notify members whose rank
// changed since last time (climbed = "moved up", dropped = "overtaken"). Stores
// the new rank on group_members.last_rank. Best-effort / never throws.
async function notifyGroupRankChanges(triggerSwimmerId) {
  try {
    const { data: memberships } = await supabase
      .from('group_members').select('group_id').eq('swimmer_id', triggerSwimmerId);

    for (const mem of memberships || []) {
      const groupId = mem.group_id;
      const { data: group } = await supabase.from('swimmer_groups').select('name').eq('id', groupId).single();
      const groupName = group?.name || 'your group';

      const board = await computeGroupLeaderboard(groupId);

      const { data: rows } = await supabase.from('group_members').select('swimmer_id, last_rank').eq('group_id', groupId);
      const lastRank = Object.fromEntries((rows || []).map(r => [r.swimmer_id, r.last_rank]));

      for (const entry of board) {
        const prev = lastRank[entry.id];
        // Only notify on an actual change, and not on the very first computation.
        if (prev != null && entry.rank !== prev) {
          if (entry.rank < prev) {
            await createNotification(entry.id, 'group_rank',
              `📈 You moved up in ${groupName}`,
              `You're now #${entry.rank} (was #${prev}). Keep it up!`,
              { groupId });
          } else {
            await createNotification(entry.id, 'group_rank',
              `📉 You were overtaken in ${groupName}`,
              `You slipped to #${entry.rank} (was #${prev}).`,
              { groupId });
          }
        }
        await supabase.from('group_members').update({ last_rank: entry.rank })
          .eq('group_id', groupId).eq('swimmer_id', entry.id);
      }
    }
  } catch (e) {
    // non-fatal
  }
}

module.exports = { computeGroupLeaderboard, notifyGroupRankChanges };
