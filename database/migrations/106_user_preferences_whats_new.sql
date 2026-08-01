-- What's New digest: per-user tracking for the release-notes popup.
--   last_seen_version: the app version whose release notes the user acknowledged
--     with "Don't show this again". When it equals the running version the
--     auto-popup is suppressed for that version.
--   show_whats_new: settings kill-switch to disable the auto-popup entirely.
ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS last_seen_version VARCHAR(50);

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS show_whats_new BOOLEAN DEFAULT true;
