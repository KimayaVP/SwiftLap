-- Coach assigns a custom training routine to a swimmer; swimmer sees it in Training.
CREATE TABLE IF NOT EXISTS coach_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL,
  swimmer_id UUID NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_routines_swimmer ON coach_routines (swimmer_id);
CREATE INDEX IF NOT EXISTS idx_coach_routines_coach ON coach_routines (coach_id);
