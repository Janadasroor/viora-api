-- Social Analytics Keyspace schema
-- Designed for High-Traffic Profile Visits and Watch Time Tracking

-- 1. Daily Aggregated Profile Analytics
-- Optimized for: "How many visits/follows did this profile get today?"
CREATE TABLE IF NOT EXISTS profile_daily_metrics (
    profile_id bigint,
    day_bucket int, -- YYYYMMDD
    metric_type text, -- 'profile_visit', 'link_click', 'follow', 'unfollow'
    count counter,
    PRIMARY KEY ((profile_id), day_bucket, metric_type)
) WITH CLUSTERING ORDER BY (day_bucket DESC, metric_type ASC)
  AND comment = 'Daily aggregated counts for profiles';

-- 2. Granular Content Watch Time Retention
-- Optimized for: "Show me the watch time for this reel over the last 24 hours"
-- Using TTL in implementation to auto-cleanup granular data
CREATE TABLE IF NOT EXISTS content_watch_retention (
    content_id uuid,
    ts timestamp,
    user_id bigint,
    duration int, -- Seconds watched in this heartbeat
    device_type text, -- 'ios', 'android', 'web'
    PRIMARY KEY ((content_id), ts, user_id)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND comment = 'High-frequency time-series for content retention mapping';

-- 3. Content Performance Totals (Counter Table)
-- Optimized for: "What is the total watch time for this video?"
CREATE TABLE IF NOT EXISTS content_performance_totals (
    content_id uuid,
    total_watch_time counter,
    total_views counter,
    total_shares counter,
    PRIMARY KEY (content_id)
) WITH comment = 'Lifetime performance stats for content';

-- 4. User Interaction Log (Privacy-respecting, short TTL)
-- Optimized for: "Did this user visit this profile in the last hour?" (To prevent duplicate count)
CREATE TABLE IF NOT EXISTS user_analytics_log (
    user_id bigint,
    target_id uuid, -- profile_id or content_id (content_id if type watch, profile_id if type visit)
    event_type text,
    ts timestamp,
    metadata map<text, text>,
    PRIMARY KEY ((user_id), ts, target_id)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND default_time_to_live = 7776000; -- 90 days default

-- 5. User Daily Usage Metrics
-- Optimized for: "How much active time did this user have today?"
CREATE TABLE IF NOT EXISTS user_daily_usage (
    user_id bigint,
    day_bucket int, -- YYYYMMDD
    metric_type text, -- 'active_time', 'watch_time'
    total_seconds counter,
    PRIMARY KEY ((user_id), day_bucket, metric_type)
) WITH CLUSTERING ORDER BY (day_bucket DESC, metric_type ASC)
  AND comment = 'Daily aggregated usage metrics per user';
