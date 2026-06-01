const { supabase } = require('../db');
const { sendPush, isConfigured } = require('./apns');

// Create an in-app notification for a user, and (best-effort) deliver it as a
// remote push to the user's registered devices. Never throws, so a notification
// failure can't break the main request that triggered it.
async function createNotification(userId, type, title, body, data) {
  if (!userId) return;
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      body: body || null,
      data: data || null,
    });
  } catch (e) {
    // swallow — notifications are non-critical
  }
  await pushToUser(userId, type, title, body, data);
}

// Fan the notification out to the user's device tokens via APNs. Prunes tokens
// Apple reports as permanently invalid.
async function pushToUser(userId, type, title, body, data) {
  if (!isConfigured()) return;
  try {
    const { data: rows } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('user_id', userId);
    const tokens = (rows || []).map((r) => r.token);
    if (tokens.length === 0) return;
    const dead = await sendPush(tokens, {
      title,
      body,
      data: { type, ...(data || {}) },
    });
    if (dead.length > 0) {
      await supabase.from('device_tokens').delete().in('token', dead);
    }
  } catch (e) {
    // swallow — push is best-effort
  }
}

module.exports = { createNotification };
