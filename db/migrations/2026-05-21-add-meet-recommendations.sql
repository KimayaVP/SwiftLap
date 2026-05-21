-- Coach recommends a meet/race to a swimmer; swimmer sees it in Meets & Races.
CREATE TABLE IF NOT EXISTS meet_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL,
  swimmer_id UUID NOT NULL,
  meet_name TEXT NOT NULL,
  meet_date DATE,
  location TEXT,
  stroke TEXT,
  distance INT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meet_recs_swimmer ON meet_recommendations (swimmer_id, status);
CREATE INDEX IF NOT EXISTS idx_meet_recs_coach ON meet_recommendations (coach_id);
