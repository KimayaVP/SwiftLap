const { createClient } = require('@supabase/supabase-js');

// Admin client — uses the service-role/secret key, which bypasses RLS. This is
// the correct context for trusted backend reads/writes. It MUST stay clean: we
// never call session-mutating auth methods (signUp/signInWithPassword) on it,
// because that would make every subsequent .from()/.storage call run as that
// user under RLS instead of as the service role. Token validation via
// auth.getUser(token) and auth.admin.* are stateless and safe here.
// SUPABASE_SERVICE_ROLE_KEY MUST stay server-side — never ship to a client.
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

const supabase = createClient(process.env.SUPABASE_URL, adminKey, noPersist);

// Auth client — uses the anon key, dedicated to user-facing sign-in/sign-up
// (signUp, signInWithPassword). Keeping these off the admin client above
// prevents the admin client from adopting a user's session.
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, noPersist);

module.exports = { supabase, supabaseAuth };
