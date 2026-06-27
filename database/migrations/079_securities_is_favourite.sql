-- Add a per-user "favourite" flag to securities so users can pin securities
-- to the dashboard Favourite Securities widget independently of holdings.
ALTER TABLE securities
    ADD COLUMN IF NOT EXISTS is_favourite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_securities_user_favourite
    ON securities(user_id, is_favourite);
