-- Product analytics event log. The app already writes to this table via
-- src/lib/tracking.js (trackEvent / logError) and reads it back through
-- GET /api/analytics/summary, but the table was originally created by hand in
-- the Supabase dashboard. This migration codifies it so the schema lives in
-- source control. Written idempotently (IF NOT EXISTS) so it is safe to run
-- against the existing production table.
CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                       -- nullable: error / account_deleted events may have no user
  event_type TEXT NOT NULL,           -- signup | login | time_logged | goal_set | badge_earned | error | ...
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dashboard queries filter/sort by recency and group by type; per-user lookups
-- back the "active users" and per-user drill-downs.
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_type_created ON analytics (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics (user_id, created_at DESC);
