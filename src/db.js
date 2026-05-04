const { createClient } = require('@supabase/supabase-js');

// Prefer the service-role/secret key on the server. It bypasses RLS,
// which is correct for trusted backend code. Falls back to the anon
// key only if the service key isn't set (e.g. local dev before setup).
// SUPABASE_SERVICE_ROLE_KEY MUST stay server-side — never ship to a client.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(process.env.SUPABASE_URL, key);

module.exports = { supabase };
