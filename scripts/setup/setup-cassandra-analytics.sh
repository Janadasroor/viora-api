#!/bin/bash

# Cassandra Analytics Schema Setup Script
# This script initializes the Cassandra tables for the analytics system

echo "🚀 Setting up Cassandra analytics schema..."

# Configuration
CASSANDRA_HOST=${CASSANDRA_HOST:-localhost}
CASSANDRA_PORT=${CASSANDRA_PORT:-9042}
KEYSPACE=${CASSANDRA_KEYSPACE:-viora_pluse_v1}
SCHEMA_FILE="$(pwd)/db_schema/viora_analytics_schema.cql"

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
cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -e "CREATE KEYSPACE IF NOT EXISTS $KEYSPACE WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}"

# Execute schema file
echo "📝 Creating analytics tables in $KEYSPACE..."
if [ -f "$SCHEMA_FILE" ]; then
    # Pipe content to avoid snap permission issues with files
    cat "$SCHEMA_FILE" | cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -k $KEYSPACE
    echo " Schema applied successfully"
else
    echo " Error: Schema file not found: $SCHEMA_FILE"
    exit 1
fi

# Verify tables were created
echo "🔍 Verifying tables..."
TABLES=$(cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -k $KEYSPACE -e "DESCRIBE TABLES;" 2>/dev/null)

for table in "profile_daily_metrics" "content_watch_retention" "content_performance_totals" "user_analytics_log" "user_daily_usage"; do
    if echo "$TABLES" | grep -q "$table"; then
        echo " $table table exists"
    else
        echo "⚠️  Warning: $table table not found"
    fi
done

echo ""
echo "🎉 Cassandra analytics schema setup complete!"
echo ""
