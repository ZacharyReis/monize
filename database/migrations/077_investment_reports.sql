-- Custom investment reports: user-defined MS Money-style portfolio column reports.
-- The selected columns, included accounts, sort, and as-of date live in `config`.

CREATE TABLE IF NOT EXISTS investment_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    background_color VARCHAR(7),
    group_by VARCHAR(20) NOT NULL DEFAULT 'NONE',
    config JSONB NOT NULL DEFAULT '{}',
    is_favourite BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_investment_reports_user_id ON investment_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_investment_reports_user_favourite ON investment_reports(user_id, is_favourite);
CREATE INDEX IF NOT EXISTS idx_investment_reports_user_sort ON investment_reports(user_id, sort_order);

DROP TRIGGER IF EXISTS update_investment_reports_updated_at ON investment_reports;
CREATE TRIGGER update_investment_reports_updated_at BEFORE UPDATE ON investment_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
