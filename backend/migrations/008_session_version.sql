-- Session invalidation: increment session_version on logout to revoke JWTs server-side.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;
