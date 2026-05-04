const { supabase } = require('../db');

const logError = async (error, context = {}) => {
  console.error(`[ERROR] ${new Date().toISOString()}:`, error.message, context);
  try {
    await supabase.from('analytics').insert({
      user_id: context.userId || null,
      event_type: 'error',
      event_data: { message: error.message, context }
    });
  } catch (e) {}
};

const trackEvent = async (userId, eventType, eventData = {}) => {
  try {
    await supabase.from('analytics').insert({
      user_id: userId,
      event_type: eventType,
      event_data: eventData
    });
  } catch (e) {}
};

module.exports = { logError, trackEvent };
