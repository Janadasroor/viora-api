-- Cassandra Schema for Messenger/Chat System
-- Keyspace: viora_pluse_v1

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id uuid PRIMARY KEY,
    members set<bigint>,
    name text,
    is_group boolean,
    group_admin bigint,
    last_message_id timeuuid,
    last_message_time timestamp,
    last_message_content text,
    created_at timestamp,
    updated_at timestamp
);

-- Messages bucketed by conversation for efficient retrieval
CREATE TABLE IF NOT EXISTS messages_by_conversation (
    conversation_id uuid,
    message_id timeuuid,
    sender_id bigint,
    message_type text, -- 'text', 'image', 'video', 'audio', 'file'
    content text,
    media_url text,
    metadata text, -- JSON string
    is_delivered boolean,
    delivered_by map<bigint, timestamp>, -- userId -> deliveredAt
    is_read boolean,
    read_by map<bigint, timestamp>, -- userId -> readAt
    is_deleted boolean,
    deleted_at timestamp,
    deleted_for set<bigint>,
    reactions map<bigint, text>, -- userId -> emoji/text
    created_at timestamp,
    PRIMARY KEY ((conversation_id), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

-- User presence and basic info for chat lookups (replacing Mongoose User)
CREATE TABLE IF NOT EXISTS user_presence (
    userId bigint PRIMARY KEY,
    name text,
    email text,
    avatar text,
    is_online boolean,
    last_seen timestamp,
    updated_at timestamp
);

-- Index for searching conversations by member (Clustering would be better but let's start with secondary index or separate table)
-- For high performance, we'd use a search table `conversations_by_user`
CREATE TABLE IF NOT EXISTS conversations_by_user (
    user_id bigint,
    conversation_id uuid,
    last_message_time timestamp,
    PRIMARY KEY ((user_id), last_message_time, conversation_id)
) WITH CLUSTERING ORDER BY (last_message_time DESC, conversation_id ASC);
