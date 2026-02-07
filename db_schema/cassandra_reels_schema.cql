-- Reel Views Table Schema
-- This table stores detailed watch logs for reels

CREATE TABLE IF NOT EXISTS reel_views (
    reel_id uuid,
    user_id int,
    watch_time float,
    duration float,
    viewed_at timestamp,
    PRIMARY KEY (reel_id, viewed_at, user_id)
) WITH CLUSTERING ORDER BY (viewed_at DESC);
