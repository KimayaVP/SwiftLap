-- In-app notification inbox for swimmers and coaches. (Push delivery via APNs
-- is added later once the paid Apple Developer org team is available.)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL,                 -- video_review | group_rank | ...
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

-- Each group member's last computed leaderboard rank, so we can detect overtakes.
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS last_rank INT;
