-- Per-user UI language preference for i18n / multi-language support.
-- The value is an ISO 639-1 code (e.g. 'en', 'fr', 'es') or a BCP 47 tag
-- (e.g. 'pt-BR') and is matched against the SUPPORTED_LOCALES list in
-- frontend/src/i18n/config.ts and backend/src/i18n/config.ts at request time.
-- This is separate from `number_format` and `date_format`, which control
-- locale-specific formatting and may differ from the UI language (e.g. a
-- user reading German UI with English-UK number grouping).

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'en';
