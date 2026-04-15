-- 052_forecast_lookback_months.sql
-- Add forecast lookback months preference for cash flow trend projection
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS forecast_lookback_months SMALLINT DEFAULT 3;
