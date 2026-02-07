SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';
CREATE TYPE public.account_status AS ENUM (
    'active',
    'suspended',
    'deactivated',
    'pending'
);
CREATE TYPE public.activity_type AS ENUM (
    'login',
    'logout',
    'post_create',
    'post_like',
    'post_comment',
    'story_create',
    'story_view',
    'profile_update',
    'follow',
    'message_send',
    'search'
);
CREATE TYPE public.block_type AS ENUM (
    'user',
    'content',
    'messages'
);
CREATE TYPE public.content_status AS ENUM (
    'draft',
    'processing',
    'published',
    'failed',
    'deleted',
    'moderation_hold',
    'shadow_hidden'
);
CREATE TYPE public.event_type AS ENUM (
    'login_success',
    'login_failed',
    'password_change',
    'email_change',
    'suspicious_activity',
    'account_locked',
    'token_revoked',
    'permission_denied',
    'data_export',
    'account_deletion'
);
CREATE TYPE public.feed_type AS ENUM (
    'home',
    'explore',
    'following'
);
CREATE TYPE public.follow_status AS ENUM (
    'pending',
    'accepted',
    'blocked'
);
CREATE TYPE public.gender_type AS ENUM (
    'male',
    'female',
    'other',
    'prefer_not_to_say'
);
CREATE TYPE public.media_type AS ENUM (
    'image',
    'video',
    'audio'
);
CREATE TYPE public.message_type AS ENUM (
    'text',
    'image',
    'video',
    'audio',
    'file',
    'post_share',
    'story_share',
    'location'
);
CREATE TYPE public.metric_type AS ENUM (
    'total_users',
    'active_users',
    'new_users',
    'total_posts',
    'new_posts',
    'total_stories',
    'new_stories',
    'total_messages'
);
CREATE TYPE public.notification_type AS ENUM (
    'like',
    'comment',
    'follow',
    'mention',
    'story_view',
    'direct_message',
    'post_share',
    'story_share',
    'comment_reply',
    'follow_request',
    'live_video',
    'new_post',
    'new_reel',
    'new_story',
    'mediaReady',
    'profile_update'
);
CREATE TYPE public.participant_role AS ENUM (
    'admin',
    'member'
);
CREATE TYPE public.post_type AS ENUM (
    'photo',
    'video',
    'carousel',
    'reel'
);
CREATE TYPE public.reaction_type AS ENUM (
    'like',
    'love',
    'laugh',
    'wow',
    'sad',
    'angry'
);
CREATE TYPE public.report_category AS ENUM (
    'spam',
    'harassment',
    'hate_speech',
    'violence',
    'self_harm',
    'nudity',
    'copyright',
    'impersonation',
    'scam',
    'other'
);
CREATE TYPE public.report_status AS ENUM (
    'pending',
    'reviewing',
    'resolved',
    'dismissed'
);
CREATE TYPE public.search_type AS ENUM (
    'posts',
    'users',
    'hashtags',
    'locations',
    'unified'
);
CREATE TYPE public.severity_type AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);
CREATE TYPE public.storage_provider AS ENUM (
    'local',
    'aws_s3',
    'cloudinary',
    'azure'
);
CREATE TYPE public.story_type AS ENUM (
    'photo',
    'video',
    'boomerang',
    'superzoom'
);
CREATE TYPE public.target_type AS ENUM (
    'post',
    'comment',
    'story',
    'user',
    'message',
    'group',
    'reel'
);
CREATE TYPE public.target_type_activity AS ENUM (
    'post',
    'user',
    'story',
    'comment',
    'message'
);
CREATE TYPE public.target_type_notification AS ENUM (
    'post',
    'comment',
    'story',
    'user',
    'message',
    'reel'
);
CREATE TYPE public.target_type_report AS ENUM (
    'post',
    'comment',
    'story',
    'user',
    'message',
    'group'
);
CREATE TYPE public.thread_type AS ENUM (
    'direct',
    'group'
);
CREATE TYPE public.token_type AS ENUM (
    'access',
    'refresh',
    'email_verification',
    'password_reset'
);
CREATE TYPE public.user_search_type AS ENUM (
    'username',
    'display_name',
    'bio'
);
CREATE TYPE public.visibility_type AS ENUM (
    'public',
    'private',
    'friends',
    'close_friends'
);
CREATE FUNCTION public.sp_cleanup_expired_stories() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
DELETE FROM stories WHERE expires_at < NOW();
END;
$$;
CREATE FUNCTION public.sp_cleanup_expired_tokens() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
DELETE FROM auth_tokens WHERE expires_at < NOW() OR is_revoked = TRUE;
END;
$$;
CREATE FUNCTION public.sp_update_trending_hashtags() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
UPDATE hashtags h
SET trending_score = (
SELECT COALESCE(
(COUNT(*) * 1.0) / NULLIF(EXTRACT(DAY FROM NOW() - MIN(p.created_at)), 0) *
(1 + LN(COUNT(DISTINCT p.user_id))), 0
)
FROM post_hashtags ph
JOIN posts p ON ph.post_id = p.post_id
WHERE ph.hashtag_id = h.hashtag_id
AND p.created_at >= NOW() - INTERVAL '24 hours'
);
UPDATE hashtags SET is_trending = FALSE;
UPDATE hashtags SET is_trending = TRUE
WHERE hashtag_id IN (
SELECT hashtag_id FROM hashtags
ORDER BY trending_score DESC
LIMIT 50
);
END;
$$;
CREATE FUNCTION public.tr_comments_update_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
RETURN NEW;
END;
$$;
CREATE FUNCTION public.tr_follows_update_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
UPDATE user_profiles
SET following_count = following_count + 1,
updated_at = CURRENT_TIMESTAMP
WHERE user_id = NEW.follower_id;
UPDATE user_profiles
SET followers_count = followers_count + 1,
updated_at = CURRENT_TIMESTAMP
WHERE user_id = NEW.following_id;
ELSIF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
UPDATE user_profiles
SET following_count = GREATEST(following_count - 1, 0),
updated_at = CURRENT_TIMESTAMP
WHERE user_id = OLD.follower_id;
UPDATE user_profiles
SET followers_count = GREATEST(followers_count - 1, 0),
updated_at = CURRENT_TIMESTAMP
WHERE user_id = OLD.following_id;
END IF;
RETURN NULL;
END;
$$;
CREATE FUNCTION public.tr_likes_update_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
RETURN NEW;
END;
$$;
CREATE FUNCTION public.tr_post_hashtags_update_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
IF TG_OP = 'INSERT' THEN
UPDATE hashtags
SET posts_count = posts_count + 1,
updated_at = CURRENT_TIMESTAMP
WHERE hashtag_id = NEW.hashtag_id;
ELSIF TG_OP = 'DELETE' THEN
UPDATE hashtags
SET posts_count = GREATEST(posts_count - 1, 0),
updated_at = CURRENT_TIMESTAMP
WHERE hashtag_id = OLD.hashtag_id;
END IF;
RETURN NULL;
END;
$$;
CREATE FUNCTION public.tr_posts_update_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
RETURN NEW;
END;
$$;
CREATE FUNCTION public.tr_shares_update_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
UPDATE posts
SET shares_count = shares_count + 1
WHERE post_id = NEW.post_id;
RETURN NULL;
END;
$$;
CREATE FUNCTION public.update_reel_trending_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
UPDATE reels
SET trending_score = (likes_count * 2 + comments_count * 3 + shares_count * 5 + views_count * 0.1) /
(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 + 2)
WHERE reel_id = NEW.reel_id;
RETURN NULL;
END;
$$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
NEW.updated_at = NOW();
RETURN NEW;
END;
$$;
SET default_tablespace = '';
CREATE TABLE public.auth_tokens (
    token_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    token_hash character varying(500),
    token_type public.token_type NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    is_revoked boolean DEFAULT false,
    device_info jsonb,
    ip_address character varying(45),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.blocked_users (
    block_id bigint NOT NULL,
    blocker_id bigint NOT NULL,
    blocked_id bigint NOT NULL,
    block_type public.block_type DEFAULT 'user'::public.block_type,
    reason character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_no_self_block CHECK ((blocker_id <> blocked_id))
);
CREATE TABLE public.collections (
    collection_id bigint NOT NULL,
    user_id bigint NOT NULL,
    collection_name character varying(100) NOT NULL,
    description text,
    cover_post_id bigint,
    posts_count integer DEFAULT 0,
    is_public boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.comments (
    comment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    parent_comment_id uuid,
    content text NOT NULL,
    likes_count integer DEFAULT 0,
    replies_count integer DEFAULT 0,
    is_pinned boolean DEFAULT false,
    is_edited boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    target_type character varying(10) DEFAULT 'post'::character varying NOT NULL,
    target_id uuid NOT NULL,
    CONSTRAINT comments_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['post'::character varying, 'reel'::character varying, 'story'::character varying])::text[])))
);
CREATE TABLE public.daily_metrics (
    metric_id bigint NOT NULL,
    metric_date date NOT NULL,
    metric_type public.metric_type NOT NULL,
    metric_value bigint NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.daily_metrics_metric_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.daily_metrics_metric_id_seq OWNED BY public.daily_metrics.metric_id;
CREATE TABLE public.feed_cache (
    cache_id bigint NOT NULL,
    user_id bigint NOT NULL,
    post_id bigint NOT NULL,
    feed_type public.feed_type NOT NULL,
    score numeric(10,4) DEFAULT 0.0000,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone NOT NULL
);
CREATE SEQUENCE public.feed_cache_cache_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.feed_cache_cache_id_seq OWNED BY public.feed_cache.cache_id;
CREATE TABLE public.feed_config (
    id integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    description text,
    updated_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.feed_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.feed_config_id_seq OWNED BY public.feed_config.id;
CREATE TABLE public.follows (
    follow_id bigint NOT NULL,
    follower_id bigint NOT NULL,
    following_id bigint NOT NULL,
    status public.follow_status DEFAULT 'accepted'::public.follow_status,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_no_self_follow CHECK ((follower_id <> following_id))
);
COMMENT ON TABLE public.follows IS 'User follow relationships';
CREATE SEQUENCE public.follows_follow_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.follows_follow_id_seq OWNED BY public.follows.follow_id;
CREATE TABLE public.hashtags (
    hashtag_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_name character varying(100) NOT NULL,
    posts_count bigint DEFAULT 0,
    trending_score numeric(10,2) DEFAULT 0.00,
    is_trending boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.likes_like_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
CREATE TABLE public.likes (
    like_id bigint DEFAULT nextval('public.likes_like_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    target_type public.target_type NOT NULL,
    target_id uuid NOT NULL,
    reaction_type public.reaction_type DEFAULT 'like'::public.reaction_type,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.media (
    user_id bigint NOT NULL,
    type character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'uploading'::character varying,
    original_filename character varying(255) NOT NULL,
    original_size bigint NOT NULL,
    original_path text NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_hash character varying(64),
    duration numeric(10,2),
    width integer,
    height integer,
    aspect_ratio character varying(10),
    codec character varying(50),
    bitrate integer,
    fps numeric(5,2),
    has_audio boolean DEFAULT true,
    audio_codec character varying(50),
    processing_progress integer DEFAULT 0,
    processing_started_at timestamp without time zone,
    processing_completed_at timestamp without time zone,
    processing_error text,
    processing_attempts integer DEFAULT 0,
    title character varying(255),
    description text,
    tags text[],
    category character varying(50),
    language character varying(10),
    visibility character varying(20) DEFAULT 'public'::character varying,
    is_mature_content boolean DEFAULT false,
    age_restriction integer,
    is_monetized boolean DEFAULT false,
    ad_enabled boolean DEFAULT false,
    revenue_generated numeric(10,2) DEFAULT 0.00,
    is_flagged boolean DEFAULT false,
    flag_reason text,
    moderation_status character varying(20) DEFAULT 'pending'::character varying,
    moderated_by bigint,
    moderated_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    published_at timestamp without time zone,
    deleted_at timestamp without time zone,
    location_lat numeric(10,8),
    location_lng numeric(11,8),
    location_name character varying(255),
    recorded_at timestamp without time zone,
    equipment jsonb,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thumbnail_path text,
    thumbnail_width integer,
    thumbnail_height integer,
    nsfw_label character varying,
    hls_path text,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT media_moderation_status_check CHECK (((moderation_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('review'::character varying)::text]))),
    CONSTRAINT media_processing_progress_check CHECK (((processing_progress >= 0) AND (processing_progress <= 100))),
    CONSTRAINT media_status_check CHECK (((status)::text = ANY (ARRAY[('uploading'::character varying)::text, ('processing'::character varying)::text, ('ready'::character varying)::text, ('failed'::character varying)::text, ('archived'::character varying)::text]))),
    CONSTRAINT media_type_check CHECK (((type)::text = ANY (ARRAY[('video'::character varying)::text, ('image'::character varying)::text, ('audio'::character varying)::text, ('document'::character varying)::text]))),
    CONSTRAINT media_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('public'::character varying)::text, ('private'::character varying)::text, ('unlisted'::character varying)::text, ('friends'::character varying)::text]))),
    CONSTRAINT valid_dimensions CHECK ((((width IS NULL) AND (height IS NULL)) OR ((width > 0) AND (height > 0)))),
    CONSTRAINT valid_duration CHECK (((duration IS NULL) OR (duration > (0)::numeric)))
);
CREATE TABLE public.media_files (
    media_id bigint NOT NULL,
    user_id bigint NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_size bigint NOT NULL,
    mime_type character varying(100) NOT NULL,
    media_type public.media_type NOT NULL,
    width integer,
    height integer,
    duration_seconds integer,
    thumbnail_path character varying(500),
    storage_provider public.storage_provider DEFAULT 'local'::public.storage_provider,
    is_processed boolean DEFAULT false,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.mentions (
    mention_id bigint NOT NULL,
    mentioned_user_id bigint NOT NULL,
    target_type public.target_type NOT NULL,
    target_id bigint NOT NULL,
    mentioned_by_user_id bigint NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.message_threads (
    thread_id bigint NOT NULL,
    thread_type public.thread_type DEFAULT 'direct'::public.thread_type,
    thread_name character varying(100),
    created_by bigint NOT NULL,
    last_message_id bigint,
    last_message_at timestamp without time zone,
    is_archived boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.messages (
    message_id bigint NOT NULL,
    thread_id bigint NOT NULL,
    sender_id bigint NOT NULL,
    message_type public.message_type DEFAULT 'text'::public.message_type,
    content text,
    media_id bigint,
    shared_post_id bigint,
    shared_story_id bigint,
    reply_to_message_id bigint,
    is_edited boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE public.messages IS 'Direct messages between users';
CREATE TABLE public.notifications (
    notification_id bigint NOT NULL,
    recipient_id bigint NOT NULL,
    actor_id bigint,
    notification_type public.notification_type NOT NULL,
    target_type public.target_type_notification,
    target_id text,
    message text,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    read_at timestamp without time zone,
    aggregation_count integer DEFAULT 1,
    actor_ids jsonb DEFAULT '[]'::jsonb,
    sample_actors jsonb DEFAULT '[]'::jsonb,
    last_aggregated_at timestamp without time zone DEFAULT now(),
    aggregation_window_start timestamp without time zone DEFAULT now()
);
COMMENT ON TABLE public.notifications IS 'User notification system';
CREATE TABLE public.post_hashtags (
    post_hashtag_id bigint NOT NULL,
    post_id uuid NOT NULL,
    hashtag_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    post_hashtag_uuid uuid DEFAULT gen_random_uuid()
);
ALTER TABLE public.post_hashtags ALTER COLUMN post_hashtag_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.post_hashtags_post_hashtag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.post_media (
    post_media_id bigint NOT NULL,
    media_id uuid NOT NULL,
    media_order smallint DEFAULT 1,
    alt_text text,
    post_id uuid
);
CREATE SEQUENCE public.post_media_post_media_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.post_media_post_media_id_seq OWNED BY public.post_media.post_media_id;
CREATE TABLE public.post_search_index (
    search_id bigint NOT NULL,
    post_id bigint NOT NULL,
    searchable_text text NOT NULL,
    hashtags text,
    location character varying(255),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.post_search_index_search_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.post_search_index_search_id_seq OWNED BY public.post_search_index.search_id;
CREATE TABLE public.post_shares (
    share_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint,
    post_id uuid,
    shared_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.posts (
    post_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    caption text,
    post_type public.post_type DEFAULT 'photo'::public.post_type NOT NULL,
    visibility public.visibility_type DEFAULT 'public'::public.visibility_type,
    location character varying(255),
    latitude numeric(10,8),
    longitude numeric(11,8),
    is_archived boolean DEFAULT false,
    comments_disabled boolean DEFAULT false,
    likes_count integer DEFAULT 0,
    comments_count integer DEFAULT 0,
    shares_count integer DEFAULT 0,
    views_count bigint DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status public.content_status DEFAULT 'processing'::public.content_status,
    caption_embedded boolean DEFAULT false
);
CREATE TABLE public.reel_likes (
    like_id uuid DEFAULT gen_random_uuid() NOT NULL,
    reel_id uuid NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.reel_media (
    reel_media_id integer NOT NULL,
    reel_id uuid,
    media_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    media_order smallint
);
CREATE SEQUENCE public.reel_media_reel_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.reel_media_reel_media_id_seq OWNED BY public.reel_media.reel_media_id;
CREATE TABLE public.reel_views (
    view_id uuid DEFAULT gen_random_uuid() NOT NULL,
    reel_id uuid NOT NULL,
    user_id bigint,
    viewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.reel_views_benchmark (
    id integer NOT NULL,
    reel_id uuid NOT NULL,
    user_id integer NOT NULL,
    watch_time double precision NOT NULL,
    duration double precision NOT NULL,
    viewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.reel_views_benchmark_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.reel_views_benchmark_id_seq OWNED BY public.reel_views_benchmark.id;
CREATE TABLE public.reels (
    reel_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    caption text,
    audio_url character varying(512),
    likes_count integer DEFAULT 0,
    comments_count integer DEFAULT 0,
    shares_count integer DEFAULT 0,
    views_count integer DEFAULT 0,
    trending_score numeric(10,2) DEFAULT 0.00,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    media_id uuid,
    status public.content_status DEFAULT 'processing'::public.content_status
);
CREATE TABLE public."reels" (
    reel_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    caption text,
    media_url character varying(512) NOT NULL,
    audio_url character varying(512),
    likes_count integer DEFAULT 0,
    comments_count integer DEFAULT 0,
    shares_count integer DEFAULT 0,
    views_count integer DEFAULT 0,
    trending_score numeric(10,2) DEFAULT 0.00,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    media_id uuid
);
CREATE TABLE public.reports (
    report_id bigint NOT NULL,
    reporter_id bigint NOT NULL,
    reported_user_id bigint,
    target_type public.target_type NOT NULL,
    target_id character varying(255) NOT NULL,
    report_category public.report_category NOT NULL,
    description text,
    status public.report_status DEFAULT 'pending'::public.report_status,
    reviewed_by bigint,
    reviewed_at timestamp without time zone,
    action_taken character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.sales (
    sale_id integer NOT NULL,
    employee_id integer,
    sale_date date,
    amount numeric(10,2),
    region character varying(50)
);
CREATE SEQUENCE public.sales_sale_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.sales_sale_id_seq OWNED BY public.sales.sale_id;
CREATE TABLE public.saved_posts (
    saved_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    saved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.search_history (
    search_id bigint NOT NULL,
    user_id bigint NOT NULL,
    search_query character varying(255) NOT NULL,
    search_type public.search_type DEFAULT 'unified'::public.search_type,
    results_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.search_history_search_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.search_history_search_id_seq OWNED BY public.search_history.search_id;
CREATE TABLE public.security_logs (
    log_id bigint NOT NULL,
    user_id bigint,
    event_type public.event_type NOT NULL,
    ip_address character varying(45),
    user_agent text,
    details jsonb,
    severity public.severity_type DEFAULT 'medium'::public.severity_type,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.security_logs_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.security_logs_log_id_seq OWNED BY public.security_logs.log_id;
CREATE TABLE public.shares (
    share_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    post_id uuid,
    share_uuid uuid DEFAULT gen_random_uuid()
);
CREATE TABLE public.stories (
    story_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    content text,
    background_color character varying(7),
    text_overlay jsonb DEFAULT '[]'::jsonb,
    stickers jsonb DEFAULT '[]'::jsonb,
    music_id bigint,
    visibility public.visibility_type DEFAULT 'public'::public.visibility_type,
    views_count integer DEFAULT 0,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    story_type public.story_type,
    status public.content_status DEFAULT 'processing'::public.content_status,
    likes_count integer DEFAULT 0,
    comments_count integer DEFAULT 0
);
CREATE TABLE public.story_media (
    story_media_id integer NOT NULL,
    story_id uuid,
    media_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    media_order smallint
);
CREATE SEQUENCE public.story_media_story_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.story_media_story_media_id_seq OWNED BY public.story_media.story_media_id;
CREATE TABLE public.story_views (
    view_id bigint NOT NULL,
    story_id bigint NOT NULL,
    viewer_id bigint NOT NULL,
    viewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.story_views_view_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.story_views_view_id_seq OWNED BY public.story_views.view_id;
CREATE TABLE public.themes (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    primarycolor character varying(15) NOT NULL,
    primaryvariantcolor character varying(15),
    secondarycolor character varying(15) NOT NULL,
    secondaryvariantcolor character varying(15),
    backgroundcolor character varying(15) NOT NULL,
    surfacecolor character varying(15) NOT NULL,
    errorcolor character varying(15) NOT NULL,
    onprimarycolor character varying(15) NOT NULL,
    onsecondarycolor character varying(15) NOT NULL,
    onbackgroundcolor character varying(15) NOT NULL,
    onsurfacecolor character varying(15) NOT NULL,
    onerrorcolor character varying(15) NOT NULL,
    fontfamily character varying(100),
    headlinelargesize real,
    headlinemediumsize real,
    headlinesmallsize real,
    bodylargesize real,
    bodymediumsize real,
    bodysmallsize real,
    labellargesize real,
    labelmediumsize real,
    labelsmallsize real,
    fontweightnormal integer,
    fontweightmedium integer,
    fontweightbold integer,
    cornersmall real,
    cornermedium real,
    cornerlarge real,
    isdarktheme boolean DEFAULT false,
    customfonturl character varying(255)
);
CREATE SEQUENCE public.themes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.themes_id_seq OWNED BY public.themes.id;
CREATE TABLE public.thread_participants (
    participant_id bigint NOT NULL,
    thread_id bigint NOT NULL,
    user_id bigint NOT NULL,
    role public.participant_role DEFAULT 'member'::public.participant_role,
    joined_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    left_at timestamp without time zone,
    last_read_message_id bigint,
    notifications_enabled boolean DEFAULT true
);
CREATE SEQUENCE public.thread_participants_participant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.thread_participants_participant_id_seq OWNED BY public.thread_participants.participant_id;
CREATE TABLE public.trending_cache (
    trend_id bigint NOT NULL,
    hashtag_id bigint NOT NULL,
    category character varying(50),
    posts_count_24h integer DEFAULT 0,
    posts_count_7d integer DEFAULT 0,
    engagement_score numeric(10,4) DEFAULT 0.0000,
    trend_rank integer DEFAULT 0,
    region character varying(2),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.trending_cache_trend_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.trending_cache_trend_id_seq OWNED BY public.trending_cache.trend_id;
CREATE TABLE public.trending_searches (
    trending_id bigint NOT NULL,
    search_query character varying(255) NOT NULL,
    search_count bigint DEFAULT 1,
    last_searched_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_trending boolean DEFAULT false,
    trending_score numeric(10,2) DEFAULT 0.00
);
CREATE SEQUENCE public.trending_searches_trending_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.trending_searches_trending_id_seq OWNED BY public.trending_searches.trending_id;
CREATE TABLE public.user_activity_logs (
    log_id bigint NOT NULL,
    user_id bigint NOT NULL,
    activity_type public.activity_type NOT NULL,
    target_type public.target_type_activity,
    target_id bigint,
    metadata jsonb,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.user_activity_logs_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_activity_logs_log_id_seq OWNED BY public.user_activity_logs.log_id;
CREATE TABLE public.user_interactions (
    interaction_id bigint NOT NULL,
    user_id uuid NOT NULL,
    target_id bigint NOT NULL,
    interaction_type character varying(50) NOT NULL,
    duration_ms integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb DEFAULT '{}'::jsonb
);
ALTER TABLE public.user_interactions ALTER COLUMN interaction_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_interactions_interaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.user_media (
    user_media_id integer NOT NULL,
    media_order smallint,
    user_id bigint,
    media_id uuid,
    alt_text text
);
CREATE SEQUENCE public.user_media_user_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_media_user_media_id_seq OWNED BY public.user_media.user_media_id;
CREATE TABLE public.user_profiles (
    profile_id bigint NOT NULL,
    user_id bigint NOT NULL,
    display_name character varying(100),
    bio text,
    profile_picture_url character varying(500),
    website character varying(255),
    location character varying(100),
    birth_date date,
    gender public.gender_type,
    is_private boolean DEFAULT false,
    is_verified boolean DEFAULT false,
    followers_count integer DEFAULT 0,
    following_count integer DEFAULT 0,
    posts_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    username character varying(100),
    is_online boolean DEFAULT false,
    safe_mode integer DEFAULT 1
);
COMMENT ON TABLE public.user_profiles IS 'Extended user profile information and social stats';
CREATE SEQUENCE public.user_profiles_profile_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_profiles_profile_id_seq OWNED BY public.user_profiles.profile_id;
CREATE TABLE public.user_search_index (
    search_id bigint NOT NULL,
    user_id bigint NOT NULL,
    searchable_text text NOT NULL,
    search_type public.user_search_type NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.user_search_index_search_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_search_index_search_id_seq OWNED BY public.user_search_index.search_id;
CREATE TABLE public.users (
    user_id bigint NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(255),
    phone character varying(20),
    password_hash character varying(255) NOT NULL,
    email_verified boolean DEFAULT false,
    phone_verified boolean DEFAULT false,
    account_status public.account_status DEFAULT 'active'::public.account_status,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_login_at timestamp without time zone,
    profile_picture_url character varying(512),
    verification_code character varying(10),
    code_expires_at timestamp without time zone,
    fcm_token character varying(512),
    is_online boolean DEFAULT false
);
COMMENT ON TABLE public.users IS 'Core user authentication and account information';
CREATE TABLE public.video_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    media_id uuid NOT NULL,
    resolution character varying(20) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    quality_label character varying(50),
    file_path text NOT NULL,
    file_size bigint NOT NULL,
    file_format character varying(10) NOT NULL,
    codec character varying(50) NOT NULL,
    codec_profile character varying(50),
    bitrate integer NOT NULL,
    target_bitrate integer,
    actual_bitrate integer,
    audio_codec character varying(50),
    audio_bitrate integer,
    audio_channels integer DEFAULT 2,
    audio_sample_rate integer DEFAULT 48000,
    fps numeric(5,2),
    keyframe_interval integer,
    is_default boolean DEFAULT false,
    hls_playlist_path text,
    dash_manifest_path text,
    segment_duration integer,
    container character varying(20) NOT NULL,
    container_flags text[],
    status character varying(20) DEFAULT 'pending'::character varying,
    processing_started_at timestamp without time zone,
    processing_completed_at timestamp without time zone,
    processing_time integer,
    processing_speed numeric(5,2),
    processing_error text,
    vmaf_score numeric(5,2),
    psnr numeric(5,2),
    ssim numeric(5,4),
    play_count bigint DEFAULT 0,
    bandwidth_used bigint DEFAULT 0,
    avg_watch_time integer,
    storage_cost numeric(10,4),
    transcoding_cost numeric(10,4),
    is_optimized boolean DEFAULT false,
    optimization_applied text[],
    cdn_url text,
    cdn_provider character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_accessed_at timestamp without time zone,
    CONSTRAINT valid_bitrate CHECK ((bitrate > 0)),
    CONSTRAINT valid_dimensions CHECK (((width > 0) AND (height > 0))),
    CONSTRAINT video_variants_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text])))
);
ALTER TABLE ONLY public.daily_metrics ALTER COLUMN metric_id SET DEFAULT nextval('public.daily_metrics_metric_id_seq'::regclass);
ALTER TABLE ONLY public.feed_cache ALTER COLUMN cache_id SET DEFAULT nextval('public.feed_cache_cache_id_seq'::regclass);
ALTER TABLE ONLY public.feed_config ALTER COLUMN id SET DEFAULT nextval('public.feed_config_id_seq'::regclass);
ALTER TABLE ONLY public.follows ALTER COLUMN follow_id SET DEFAULT nextval('public.follows_follow_id_seq'::regclass);
ALTER TABLE ONLY public.post_media ALTER COLUMN post_media_id SET DEFAULT nextval('public.post_media_post_media_id_seq'::regclass);
ALTER TABLE ONLY public.post_search_index ALTER COLUMN search_id SET DEFAULT nextval('public.post_search_index_search_id_seq'::regclass);
ALTER TABLE ONLY public.reel_media ALTER COLUMN reel_media_id SET DEFAULT nextval('public.reel_media_reel_media_id_seq'::regclass);
ALTER TABLE ONLY public.reel_views_benchmark ALTER COLUMN id SET DEFAULT nextval('public.reel_views_benchmark_id_seq'::regclass);
ALTER TABLE ONLY public.sales ALTER COLUMN sale_id SET DEFAULT nextval('public.sales_sale_id_seq'::regclass);
ALTER TABLE ONLY public.search_history ALTER COLUMN search_id SET DEFAULT nextval('public.search_history_search_id_seq'::regclass);
ALTER TABLE ONLY public.security_logs ALTER COLUMN log_id SET DEFAULT nextval('public.security_logs_log_id_seq'::regclass);
ALTER TABLE ONLY public.story_media ALTER COLUMN story_media_id SET DEFAULT nextval('public.story_media_story_media_id_seq'::regclass);
ALTER TABLE ONLY public.story_views ALTER COLUMN view_id SET DEFAULT nextval('public.story_views_view_id_seq'::regclass);
ALTER TABLE ONLY public.themes ALTER COLUMN id SET DEFAULT nextval('public.themes_id_seq'::regclass);
ALTER TABLE ONLY public.thread_participants ALTER COLUMN participant_id SET DEFAULT nextval('public.thread_participants_participant_id_seq'::regclass);
ALTER TABLE ONLY public.trending_cache ALTER COLUMN trend_id SET DEFAULT nextval('public.trending_cache_trend_id_seq'::regclass);
ALTER TABLE ONLY public.trending_searches ALTER COLUMN trending_id SET DEFAULT nextval('public.trending_searches_trending_id_seq'::regclass);
ALTER TABLE ONLY public.user_activity_logs ALTER COLUMN log_id SET DEFAULT nextval('public.user_activity_logs_log_id_seq'::regclass);
ALTER TABLE ONLY public.user_media ALTER COLUMN user_media_id SET DEFAULT nextval('public.user_media_user_media_id_seq'::regclass);
ALTER TABLE ONLY public.user_profiles ALTER COLUMN profile_id SET DEFAULT nextval('public.user_profiles_profile_id_seq'::regclass);
ALTER TABLE ONLY public.user_search_index ALTER COLUMN search_id SET DEFAULT nextval('public.user_search_index_search_id_seq'::regclass);
ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_pkey PRIMARY KEY (token_id);
ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_pkey PRIMARY KEY (block_id);
ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (collection_id);
ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (comment_id);
ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_pkey PRIMARY KEY (metric_id);
ALTER TABLE ONLY public.feed_cache
    ADD CONSTRAINT feed_cache_pkey PRIMARY KEY (cache_id);
ALTER TABLE ONLY public.feed_config
    ADD CONSTRAINT feed_config_key_key UNIQUE (key);
ALTER TABLE ONLY public.feed_config
    ADD CONSTRAINT feed_config_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follow_id);
ALTER TABLE ONLY public.hashtags
    ADD CONSTRAINT hashtags_pkey PRIMARY KEY (hashtag_id);
ALTER TABLE ONLY public.hashtags
    ADD CONSTRAINT hashtags_tag_name_key UNIQUE (tag_name);
ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_unique_per_target UNIQUE (user_id, target_id, target_type);
ALTER TABLE ONLY public.media_files
    ADD CONSTRAINT media_files_pkey PRIMARY KEY (media_id);
ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_media_id_unique UNIQUE (id);
ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_pkey PRIMARY KEY (mention_id);
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_pkey PRIMARY KEY (thread_id);
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (message_id);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);
ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT post_hashtags_pkey PRIMARY KEY (post_hashtag_id);
ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT post_media_pkey PRIMARY KEY (post_media_id);
ALTER TABLE ONLY public.post_search_index
    ADD CONSTRAINT post_search_index_pkey PRIMARY KEY (search_id);
ALTER TABLE ONLY public.post_search_index
    ADD CONSTRAINT post_search_index_post_id_key UNIQUE (post_id);
ALTER TABLE ONLY public.post_shares
    ADD CONSTRAINT post_shares_pkey PRIMARY KEY (share_id);
ALTER TABLE ONLY public.post_shares
    ADD CONSTRAINT post_shares_user_id_post_id_key UNIQUE (user_id, post_id);
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (post_id);
ALTER TABLE ONLY public.reel_likes
    ADD CONSTRAINT reel_likes_pkey PRIMARY KEY (like_id);
ALTER TABLE ONLY public.reel_likes
    ADD CONSTRAINT reel_likes_reel_id_user_id_key UNIQUE (reel_id, user_id);
ALTER TABLE ONLY public.reel_media
    ADD CONSTRAINT reel_media_pkey PRIMARY KEY (reel_media_id);
ALTER TABLE ONLY public.reel_views_benchmark
    ADD CONSTRAINT reel_views_benchmark_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_pkey PRIMARY KEY (view_id);
ALTER TABLE ONLY public."reels"
    ADD CONSTRAINT reels_pkey PRIMARY KEY (reel_id);
ALTER TABLE ONLY public.reels
    ADD CONSTRAINT reels_reel_id_unique UNIQUE (reel_id);
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (report_id);
ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (sale_id);
ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_pkey PRIMARY KEY (saved_id);
ALTER TABLE ONLY public.search_history
    ADD CONSTRAINT search_history_pkey PRIMARY KEY (search_id);
ALTER TABLE ONLY public.security_logs
    ADD CONSTRAINT security_logs_pkey PRIMARY KEY (log_id);
ALTER TABLE ONLY public.shares
    ADD CONSTRAINT shares_pkey PRIMARY KEY (share_id);
ALTER TABLE ONLY public.stories
    ADD CONSTRAINT story_id_unique UNIQUE (story_id);
ALTER TABLE ONLY public.story_media
    ADD CONSTRAINT story_media_pkey PRIMARY KEY (story_media_id);
ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_pkey PRIMARY KEY (view_id);
ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT thread_participants_pkey PRIMARY KEY (participant_id);
ALTER TABLE ONLY public.trending_cache
    ADD CONSTRAINT trending_cache_pkey PRIMARY KEY (trend_id);
ALTER TABLE ONLY public.trending_searches
    ADD CONSTRAINT trending_searches_pkey PRIMARY KEY (trending_id);
ALTER TABLE ONLY public.trending_searches
    ADD CONSTRAINT trending_searches_search_query_key UNIQUE (search_query);
ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT uk_blocker_blocked UNIQUE (blocker_id, blocked_id);
ALTER TABLE ONLY public.follows
    ADD CONSTRAINT uk_follow_relationship UNIQUE (follower_id, following_id);
ALTER TABLE ONLY public.trending_cache
    ADD CONSTRAINT uk_hashtag_region UNIQUE (hashtag_id, region);
ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT uk_mention_target UNIQUE (mentioned_user_id, target_type, target_id);
ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT uk_metric_date_type UNIQUE (metric_date, metric_type);
ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT uk_post_hashtag UNIQUE (post_id, hashtag_id);
ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT uk_story_viewer UNIQUE (story_id, viewer_id);
ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT uk_thread_user UNIQUE (thread_id, user_id);
ALTER TABLE ONLY public.feed_cache
    ADD CONSTRAINT uk_user_post_feed UNIQUE (user_id, post_id, feed_type);
ALTER TABLE ONLY public.user_search_index
    ADD CONSTRAINT uk_user_search_type UNIQUE (user_id, search_type);
ALTER TABLE ONLY public.video_variants
    ADD CONSTRAINT unique_media_resolution UNIQUE (media_id, resolution, container);
ALTER TABLE ONLY public.user_activity_logs
    ADD CONSTRAINT user_activity_logs_pkey PRIMARY KEY (log_id);
ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT user_interactions_pkey PRIMARY KEY (interaction_id);
ALTER TABLE ONLY public.user_media
    ADD CONSTRAINT user_media_pkey PRIMARY KEY (user_media_id);
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (profile_id);
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.user_search_index
    ADD CONSTRAINT user_search_index_pkey PRIMARY KEY (search_id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE ONLY public.video_variants
    ADD CONSTRAINT video_variants_pkey PRIMARY KEY (id);
CREATE INDEX idx_account_status ON public.users USING btree (account_status);
CREATE INDEX idx_activity_type ON public.user_activity_logs USING btree (activity_type);
CREATE INDEX idx_actor_notifications ON public.notifications USING btree (actor_id);
CREATE INDEX idx_bio_fulltext ON public.user_profiles USING gin (to_tsvector('english'::regconfig, COALESCE(bio, ''::text)));
CREATE INDEX idx_block_type ON public.blocked_users USING btree (block_type);
CREATE INDEX idx_blocked ON public.blocked_users USING btree (blocked_id);
CREATE INDEX idx_blocker ON public.blocked_users USING btree (blocker_id);
CREATE INDEX idx_caption_fulltext ON public.posts USING gin (to_tsvector('english'::regconfig, COALESCE(caption, ''::text)));
CREATE INDEX idx_category ON public.trending_cache USING btree (category);
CREATE INDEX idx_collection_name ON public.collections USING btree (collection_name);
CREATE INDEX idx_content_fulltext ON public.comments USING gin (to_tsvector('english'::regconfig, content));
CREATE INDEX idx_content_fulltext_messages ON public.messages USING gin (to_tsvector('english'::regconfig, COALESCE(content, ''::text)));
CREATE INDEX idx_count ON public.trending_searches USING btree (search_count);
CREATE INDEX idx_created_at ON public.users USING btree (created_at);
CREATE INDEX idx_created_at_activity ON public.user_activity_logs USING btree (created_at);
CREATE INDEX idx_created_at_blocked ON public.blocked_users USING btree (created_at);
CREATE INDEX idx_created_at_collections ON public.collections USING btree (created_at);
CREATE INDEX idx_created_at_comments ON public.comments USING btree (created_at);
CREATE INDEX idx_created_at_follows ON public.follows USING btree (created_at);
CREATE INDEX idx_created_at_hashtags ON public.hashtags USING btree (created_at);
CREATE INDEX idx_created_at_media ON public.media_files USING btree (created_at);
CREATE INDEX idx_created_at_mentions ON public.mentions USING btree (created_at);
CREATE INDEX idx_created_at_messages ON public.messages USING btree (created_at);
CREATE INDEX idx_created_at_metrics ON public.daily_metrics USING btree (created_at);
CREATE INDEX idx_created_at_notifications ON public.notifications USING btree (created_at);
CREATE INDEX idx_created_at_post_hashtags ON public.post_hashtags USING btree (created_at);
CREATE INDEX idx_created_at_posts ON public.posts USING btree (created_at);
CREATE INDEX idx_created_at_reports ON public.reports USING btree (created_at);
CREATE INDEX idx_created_at_security ON public.security_logs USING btree (created_at);
CREATE INDEX idx_created_by ON public.message_threads USING btree (created_by);
CREATE INDEX idx_display_name ON public.user_profiles USING btree (display_name);
CREATE INDEX idx_display_name_fulltext ON public.user_profiles USING gin (to_tsvector('english'::regconfig, (COALESCE(display_name, ''::character varying))::text));
CREATE INDEX idx_email ON public.users USING btree (email);
CREATE INDEX idx_engagement_score_trending ON public.trending_cache USING btree (engagement_score);
CREATE INDEX idx_event_type ON public.security_logs USING btree (event_type);
CREATE INDEX idx_expires_at ON public.auth_tokens USING btree (expires_at);
CREATE INDEX idx_expires_at_feed ON public.feed_cache USING btree (expires_at);
CREATE INDEX idx_file_path ON public.media_files USING btree (file_path);
CREATE INDEX idx_follower ON public.follows USING btree (follower_id);
CREATE INDEX idx_followers_count ON public.user_profiles USING btree (followers_count);
CREATE INDEX idx_following ON public.follows USING btree (following_id);
CREATE INDEX idx_follows_following_status ON public.follows USING btree (following_id, status);
CREATE INDEX idx_hashtag_posts ON public.post_hashtags USING btree (hashtag_id);
CREATE INDEX idx_ip_address ON public.security_logs USING btree (ip_address);
CREATE INDEX idx_is_archived ON public.posts USING btree (is_archived);
CREATE INDEX idx_is_archived_threads ON public.message_threads USING btree (is_archived);
CREATE INDEX idx_is_pinned ON public.comments USING btree (is_pinned);
CREATE INDEX idx_is_private ON public.user_profiles USING btree (is_private);
CREATE INDEX idx_is_processed ON public.media_files USING btree (is_processed);
CREATE INDEX idx_is_public ON public.collections USING btree (is_public);
CREATE INDEX idx_is_read ON public.notifications USING btree (is_read);
CREATE INDEX idx_is_revoked ON public.auth_tokens USING btree (is_revoked);
CREATE INDEX idx_is_trending ON public.hashtags USING btree (is_trending);
CREATE INDEX idx_is_verified ON public.user_profiles USING btree (is_verified);
CREATE INDEX idx_last_message_at ON public.message_threads USING btree (last_message_at);
CREATE INDEX idx_likes_count ON public.posts USING btree (likes_count);
CREATE INDEX idx_location ON public.posts USING btree (location);
CREATE INDEX idx_location_profile ON public.user_profiles USING btree (location);
CREATE INDEX idx_location_search ON public.posts USING btree (location, visibility, is_archived);
CREATE INDEX idx_media_created_at ON public.media USING btree (created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_media_nsfw_label ON public.media USING btree (nsfw_label);
CREATE INDEX idx_media_search ON public.media USING gin (to_tsvector('english'::regconfig, (((title)::text || ' '::text) || COALESCE(description, ''::text))));
CREATE INDEX idx_media_status ON public.media USING btree (status);
CREATE INDEX idx_media_tags ON public.media USING gin (tags);
CREATE INDEX idx_media_type ON public.media_files USING btree (media_type);
CREATE INDEX idx_media_type1 ON public.media USING btree (type) WHERE (deleted_at IS NULL);
CREATE INDEX idx_media_user_created ON public.media USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_media_user_id ON public.media USING btree (user_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_media_visibility ON public.media USING btree (visibility) WHERE (deleted_at IS NULL);
CREATE INDEX idx_mentioned_by ON public.mentions USING btree (mentioned_by_user_id);
CREATE INDEX idx_mentioned_user ON public.mentions USING btree (mentioned_user_id);
CREATE INDEX idx_message_type ON public.messages USING btree (message_type);
CREATE INDEX idx_messages_thread_created ON public.messages USING btree (thread_id, created_at DESC);
CREATE INDEX idx_metric_date ON public.daily_metrics USING btree (metric_date);
CREATE INDEX idx_metric_type ON public.daily_metrics USING btree (metric_type);
CREATE INDEX idx_notification_type ON public.notifications USING btree (notification_type);
CREATE INDEX idx_notifications_aggregation ON public.notifications USING btree (recipient_id, target_type, target_id, is_read) WHERE (created_at > '2025-12-01 00:00:00'::timestamp without time zone);
CREATE INDEX idx_notifications_recipient_read_created ON public.notifications USING btree (recipient_id, is_read, created_at);
CREATE INDEX idx_parent_comment ON public.comments USING btree (parent_comment_id);
CREATE INDEX idx_phone ON public.users USING btree (phone);
CREATE INDEX idx_post_hashtags ON public.post_hashtags USING btree (post_id);
CREATE INDEX idx_post_type ON public.posts USING btree (post_type);
CREATE INDEX idx_posts_caption_embedded ON public.posts USING btree (caption_embedded) WHERE ((caption_embedded = false) AND (status = 'published'::public.content_status));
CREATE INDEX idx_posts_caption_fts ON public.posts USING gin (to_tsvector('english'::regconfig, COALESCE(caption, ''::text)));
CREATE INDEX idx_posts_count ON public.hashtags USING btree (posts_count);
CREATE INDEX idx_posts_type_created ON public.posts USING btree (post_type, created_at);
CREATE INDEX idx_posts_user_visibility_created ON public.posts USING btree (user_id, visibility, created_at);
CREATE INDEX idx_query ON public.search_history USING btree (search_query);
CREATE INDEX idx_recipient_notifications ON public.notifications USING btree (recipient_id);
CREATE INDEX idx_recipient_unread ON public.notifications USING btree (recipient_id, is_read);
CREATE INDEX idx_region ON public.trending_cache USING btree (region);
CREATE INDEX idx_report_category ON public.reports USING btree (report_category);
CREATE INDEX idx_reported_user ON public.reports USING btree (reported_user_id);
CREATE INDEX idx_reporter ON public.reports USING btree (reporter_id);
CREATE INDEX idx_reviewed_by ON public.reports USING btree (reviewed_by);
CREATE INDEX idx_role ON public.thread_participants USING btree (role);
CREATE INDEX idx_score ON public.feed_cache USING btree (score);
CREATE INDEX idx_search_posts ON public.posts USING btree (visibility, is_archived, created_at);
CREATE INDEX idx_search_type ON public.user_search_index USING btree (search_type);
CREATE INDEX idx_searchable_content ON public.post_search_index USING gin (to_tsvector('english'::regconfig, ((((searchable_text || ' '::text) || COALESCE(hashtags, ''::text)) || ' '::text) || (COALESCE(location, ''::character varying))::text)));
CREATE INDEX idx_searchable_text ON public.user_search_index USING gin (to_tsvector('english'::regconfig, searchable_text));
CREATE INDEX idx_sender_messages ON public.messages USING btree (sender_id);
CREATE INDEX idx_severity ON public.security_logs USING btree (severity);
CREATE INDEX idx_status ON public.follows USING btree (status);
CREATE INDEX idx_status_reports ON public.reports USING btree (status);
CREATE INDEX idx_story_views ON public.story_views USING btree (story_id);
CREATE INDEX idx_tag_name_fulltext ON public.hashtags USING gin (to_tsvector('english'::regconfig, (tag_name)::text));
CREATE INDEX idx_tag_search ON public.hashtags USING btree (tag_name, posts_count);
CREATE INDEX idx_target_activity ON public.user_activity_logs USING btree (target_type, target_id);
CREATE INDEX idx_target_mentions ON public.mentions USING btree (target_type, target_id);
CREATE INDEX idx_target_notifications ON public.notifications USING btree (target_type, target_id);
CREATE INDEX idx_target_reports ON public.reports USING btree (target_type, target_id);
CREATE INDEX idx_thread_created ON public.messages USING btree (thread_id, created_at);
CREATE INDEX idx_thread_messages ON public.messages USING btree (thread_id);
CREATE INDEX idx_thread_participants ON public.thread_participants USING btree (thread_id);
CREATE INDEX idx_thread_type ON public.message_threads USING btree (thread_type);
CREATE INDEX idx_token_hash ON public.auth_tokens USING btree (token_hash);
CREATE INDEX idx_trend_rank ON public.trending_cache USING btree (trend_rank);
CREATE INDEX idx_trending ON public.trending_searches USING btree (is_trending, trending_score);
CREATE INDEX idx_trending_score ON public.hashtags USING btree (trending_score);
CREATE INDEX idx_updated_at_trending ON public.trending_cache USING btree (updated_at);
CREATE INDEX idx_user_activity ON public.user_activity_logs USING btree (user_id);
CREATE INDEX idx_user_collections ON public.collections USING btree (user_id);
CREATE INDEX idx_user_comments ON public.comments USING btree (user_id);
CREATE INDEX idx_user_created ON public.posts USING btree (user_id, created_at);
CREATE INDEX idx_user_date ON public.user_activity_logs USING btree (user_id, created_at);
CREATE INDEX idx_user_feed ON public.feed_cache USING btree (user_id, feed_type);
CREATE INDEX idx_user_feed_score ON public.feed_cache USING btree (user_id, feed_type, score);
CREATE INDEX idx_user_interactions_created_at ON public.user_interactions USING btree (created_at);
CREATE INDEX idx_user_interactions_target_id ON public.user_interactions USING btree (target_id);
CREATE INDEX idx_user_interactions_user_id ON public.user_interactions USING btree (user_id);
CREATE INDEX idx_user_media ON public.media_files USING btree (user_id);
CREATE INDEX idx_user_posts ON public.posts USING btree (user_id);
CREATE INDEX idx_user_profiles_display_name_trgm ON public.user_profiles USING gin (display_name public.gin_trgm_ops);
CREATE INDEX idx_user_searches ON public.search_history USING btree (user_id, created_at);
CREATE INDEX idx_user_security ON public.security_logs USING btree (user_id);
CREATE INDEX idx_user_threads ON public.thread_participants USING btree (user_id);
CREATE INDEX idx_user_token ON public.auth_tokens USING btree (user_id, token_type);
CREATE INDEX idx_username ON public.users USING btree (username);
CREATE INDEX idx_username_profile ON public.user_profiles USING btree (username);
CREATE INDEX idx_username_search ON public.users USING btree (username, account_status);
CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_username_trgm ON public.users USING gin (username public.gin_trgm_ops);
CREATE INDEX idx_variants_default ON public.video_variants USING btree (media_id) WHERE (is_default = true);
CREATE INDEX idx_variants_media_id ON public.video_variants USING btree (media_id, resolution);
CREATE INDEX idx_variants_popular ON public.video_variants USING btree (media_id, play_count DESC);
CREATE INDEX idx_variants_processing ON public.video_variants USING btree (status, created_at) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text]));
CREATE INDEX idx_variants_resolution ON public.video_variants USING btree (media_id, resolution) WHERE ((status)::text = 'completed'::text);
CREATE INDEX idx_viewed_at ON public.story_views USING btree (viewed_at);
CREATE INDEX idx_viewer_views ON public.story_views USING btree (viewer_id);
CREATE INDEX idx_visibility ON public.posts USING btree (visibility);
CREATE TRIGGER tr_collections_updated_at BEFORE UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tr_follows_delete_update_counts AFTER DELETE ON public.follows FOR EACH ROW EXECUTE FUNCTION public.tr_follows_update_counts();
CREATE TRIGGER tr_follows_insert_update_counts AFTER INSERT ON public.follows FOR EACH ROW EXECUTE FUNCTION public.tr_follows_update_counts();
CREATE TRIGGER tr_follows_updated_at BEFORE UPDATE ON public.follows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tr_message_threads_updated_at BEFORE UPDATE ON public.message_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tr_messages_updated_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tr_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tr_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tr_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.comments(comment_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.feed_cache
    ADD CONSTRAINT feed_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.media_files
    ADD CONSTRAINT media_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_moderated_by_fkey FOREIGN KEY (moderated_by) REFERENCES public.users(user_id);
ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT media_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_mentioned_by_user_id_fkey FOREIGN KEY (mentioned_by_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_mentioned_user_id_fkey FOREIGN KEY (mentioned_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media_files(media_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.messages(message_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.message_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT post_hashtags_hashtag_id_fkey FOREIGN KEY (hashtag_id) REFERENCES public.hashtags(hashtag_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT post_hashtags_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT post_media_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_shares
    ADD CONSTRAINT post_shares_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_shares
    ADD CONSTRAINT post_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reel_likes
    ADD CONSTRAINT reel_likes_reel_id_fkey FOREIGN KEY (reel_id) REFERENCES public."reels"(reel_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reel_likes
    ADD CONSTRAINT reel_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reel_media
    ADD CONSTRAINT reel_media_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reel_media
    ADD CONSTRAINT reel_media_reel_id_fkey FOREIGN KEY (reel_id) REFERENCES public.reels(reel_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_reel_id_fkey FOREIGN KEY (reel_id) REFERENCES public."reels"(reel_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE ONLY public."reels"
    ADD CONSTRAINT reels_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."reels"
    ADD CONSTRAINT reels_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.search_history
    ADD CONSTRAINT search_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.security_logs
    ADD CONSTRAINT security_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.shares
    ADD CONSTRAINT shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.story_media
    ADD CONSTRAINT story_media_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.story_media
    ADD CONSTRAINT story_media_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(story_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT thread_participants_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.message_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT thread_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_activity_logs
    ADD CONSTRAINT user_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_media
    ADD CONSTRAINT user_media_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id);
ALTER TABLE ONLY public.user_media
    ADD CONSTRAINT user_media_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_username_fkey FOREIGN KEY (username) REFERENCES public.users(username) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.user_search_index
    ADD CONSTRAINT user_search_index_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.video_variants
    ADD CONSTRAINT video_variants_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE CASCADE;
\unrestrict 6xWdcCK6yn4qraAAojWTsefCqogqUEFgQ4YHED0yNybdimL8DCTyORpU7ffCbUs