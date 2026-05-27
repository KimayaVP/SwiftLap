-- Meets & Races: multiple events per meet, each with an optional EXPECTED time
-- (for upcoming meets) and an actual TIME logged after the meet is over.
-- Each meet_results row now represents ONE event of a meet for a swimmer.

-- Expected/goal time (seconds) for an upcoming event. NULL once it's a past result.
ALTER TABLE meet_results ADD COLUMN IF NOT EXISTS expected_seconds NUMERIC;

-- The actual result time is now optional: an upcoming event has no time yet.
ALTER TABLE meet_results ALTER COLUMN time_seconds DROP NOT NULL;

-- When the actual time was logged (NULL = not swum/logged yet).
ALTER TABLE meet_results ADD COLUMN IF NOT EXISTS result_logged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_meet_results_meet_swimmer ON meet_results (meet_id, swimmer_id);
