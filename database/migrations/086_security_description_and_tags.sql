-- Adds a free-text description to securities and a many-to-many tag join table
-- (security_tags), mirroring the transaction_tags pattern so users can classify
-- securities with their own labels and see the portfolio split by those labels.

ALTER TABLE securities ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS security_tags (
    security_id UUID NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (security_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_security_tags_tag ON security_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_security_tags_security ON security_tags(security_id);
