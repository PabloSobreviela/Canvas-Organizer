-- Legal consent timestamps (ToS + Privacy + AI disclosure accepted together).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS legal_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_consent_version TEXT;
