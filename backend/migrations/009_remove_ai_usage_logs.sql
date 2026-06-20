-- Remove the retired AI telemetry store after historical rows have been purged.
DROP TABLE IF EXISTS ai_usage_logs;
