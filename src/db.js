const { createClient } = require('@supabase/supabase-js');

// Prefer the service-role/secret key on the server. It bypasses RLS,
// which is correct for trusted backend code. Falls back to the anon
// key only if the service key isn't set (e.g. local dev before setup).
// SUPABASE_SERVICE_ROLE_KEY MUST stay server-side — never ship to a client.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// One-off diagnostic at startup. Tells us in Render logs whether the
// service-role key is actually being picked up. Safe to log a prefix.
const urlPrefix = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.slice(0, 35) : 'MISSING';
console.log(`[db] url: ${urlPrefix}`);
console.log(`[db] key: ${key ? key.slice(0, 12) + '...' : 'MISSING'} (service role set: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY})`);

const supabase = createClient(process.env.SUPABASE_URL, key);

// Test query on boot to see whether RLS is blocking us.
supabase.from('watch_workouts').select('id', { count: 'exact', head: true })
  .then(r => console.log(`[db] boot test query: count=${r.count}, error=${r.error?.message || 'none'}`))
  .catch(e => console.log(`[db] boot test query threw: ${e.message}`));

module.exports = { supabase };
