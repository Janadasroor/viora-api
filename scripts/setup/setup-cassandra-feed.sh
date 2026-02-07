#!/bin/bash

# Cassandra Feed Schema Setup Script
# This script initializes the Cassandra tables for the feed system

echo "🚀 Setting up Cassandra feed schema..."

# Configuration
CASSANDRA_HOST=${CASSANDRA_HOST:-localhost}
CASSANDRA_PORT=${CASSANDRA_PORT:-9042}
KEYSPACE=${CASSANDRA_KEYSPACE:-viora_pluse_v1}
SCHEMA_FILE="db_schema/cassandra_feed_schema.cql"

# Check if Cassandra is running
echo "📡 Checking Cassandra connection..."
if ! cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -e "SELECT now() FROM system.local;" > /dev/null 2>&1; then
    echo " Error: Cannot connect to Cassandra at $CASSANDRA_HOST:$CASSANDRA_PORT"
    echo "   Please ensure Cassandra is running and accessible."
    exit 1
fi

echo " Cassandra is running"

# Create keyspace if it doesn't exist
echo "🔧 Ensuring keyspace exists: $KEYSPACE"
cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -e "CREATE KEYSPACE IF NOT EXISTS $KEYSPACE WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};"

# Execute schema file
echo "📝 Creating feed tables..."
if [ -f "$SCHEMA_FILE" ]; then
    # Use pipe to avoid snap permission issues with -f
    cat "$SCHEMA_FILE" | cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -k $KEYSPACE
    echo " Schema created successfully"
else
    echo " Error: Schema file not found: $SCHEMA_FILE"
    exit 1
fi

# Verify tables were created
echo "🔍 Verifying tables..."
TABLES=$(cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -k $KEYSPACE -e "DESCRIBE TABLES;" 2>/dev/null)

check_table() {
    if echo "$TABLES" | grep -q "$1"; then
        echo " $1 table created"
    else
        echo "⚠️  Warning: $1 table not found"
    fi
}

check_table "post_metadata"
check_table "suggested_posts_cache"
check_table "user_interactions"
check_table "posts_by_engagement"
check_table "user_feed_cache"

echo ""
echo "Cassandra feed schema setup complete!"
echo ""
echo "Next steps:"
echo "  1. Ensure Qdrant is running with media_embeddings collection"
echo "  2. Restart your Node.js server"
echo "  3. Test the /api/feed/suggested endpoint"
echo ""
