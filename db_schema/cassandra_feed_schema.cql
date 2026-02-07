-- Cassandra Schema for Feed System
-- Keyspace: viora_pluse_v1

-- Posts table optimized for feed queries
CREATE TABLE IF NOT EXISTS posts_by_engagement (
    post_id uuid,
    user_id bigint,
    caption text,
    post_type text,
    visibility text,
    location text,
    likes_count int,
    comments_count int,
    shares_count int,
    created_at timestamp,
    engagement_score double,
    PRIMARY KEY ((post_id), created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy'}
  AND default_time_to_live = 2592000; -- 30 days TTL

-- User interactions for personalization
CREATE TABLE IF NOT EXISTS user_interactions (
    user_id bigint,
    target_id uuid,
    target_type text,
    interaction_type text, -- 'like', 'comment', 'save', 'share'
    created_at timestamp,
    PRIMARY KEY ((user_id), created_at, target_id)
) WITH CLUSTERING ORDER BY (created_at DESC, target_id ASC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy'};

-- Suggested posts cache per user
CREATE TABLE IF NOT EXISTS suggested_posts_cache (
    user_id bigint,
    post_id uuid,
    relevance_score double,
    reason text,
    cached_at timestamp,
    PRIMARY KEY ((user_id), relevance_score, post_id)
) WITH CLUSTERING ORDER BY (relevance_score DESC, post_id DESC)
  AND default_time_to_live = 3600; -- 1 hour cache

-- Post metadata for quick lookups
CREATE TABLE IF NOT EXISTS post_metadata (
    post_id uuid PRIMARY KEY,
    user_id bigint,
    username text,
    display_name text,
    is_verified boolean,
    caption text,
    post_type text,
    visibility text,
    location text,
    likes_count int,
    comments_count int,
    shares_count int,
    created_at timestamp,
    hashtags list<text>,
    has_media boolean
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS ON post_metadata (user_id);
CREATE INDEX IF NOT EXISTS ON post_metadata (created_at);

-- Precomputed User Feed Cache
CREATE TABLE IF NOT EXISTS user_feed_cache (
    user_id bigint,
    post_id uuid,
    score double,
    source text, -- 'following', 'suggested', 'trending'
    created_at timestamp,
    cached_at timestamp,
    PRIMARY KEY ((user_id), score, post_id)
) WITH CLUSTERING ORDER BY (score DESC, post_id DESC)
  AND default_time_to_live = 86400; -- 24 hours cache
