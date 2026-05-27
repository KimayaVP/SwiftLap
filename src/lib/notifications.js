const { supabase } = require('../db');

// Create an in-app notification for a user. Best-effort: never throws, so a
// notification failure can't break the main request that triggered it.
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
}

module.exports = { createNotification };
