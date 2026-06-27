-- Opt-in toggle for the app-wide floating AI chat bubble. Default OFF so the
-- bubble only appears for users who explicitly enable it in AI Settings.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS ai_bubble_enabled BOOLEAN DEFAULT false;
