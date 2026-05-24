-- Coach review of swimmer videos (Option A).
-- Adds columns so a coach can leave written feedback on a swimmer's uploaded clip.
-- Run this in the Supabase SQL editor.

alter table video_feedback
  add column if not exists coach_feedback text,
  add column if not exists coach_feedback_at timestamptz,
  add column if not exists coach_id uuid;
