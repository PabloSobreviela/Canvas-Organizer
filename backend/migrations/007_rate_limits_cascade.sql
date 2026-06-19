-- Defense-in-depth cleanup of rate_limits on user deletion (R10).
--
-- rate_limits.user_id is TEXT while users.id is UUID, so a conventional FK with
-- ON DELETE CASCADE cannot be declared directly. Instead we attach an AFTER
-- DELETE trigger on users that purges the user's rate-limit buckets. This makes
-- cleanup automatic even if application code forgets to delete them, and is
-- type-agnostic (works for UUID and any legacy/demo text ids).

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_id ON rate_limits (user_id);

CREATE OR REPLACE FUNCTION purge_rate_limits_for_deleted_user()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM rate_limits WHERE user_id = OLD.id::text;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purge_rate_limits_on_user_delete ON users;
CREATE TRIGGER trg_purge_rate_limits_on_user_delete
    AFTER DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION purge_rate_limits_for_deleted_user();
