#!/bin/bash

# Cassandra Reels Schema Setup Script
# This script initializes the Cassandra tables for the reels system

echo "🚀 Setting up Cassandra reels schema..."

# Configuration
CASSANDRA_HOST=${CASSANDRA_HOST:-localhost}
CASSANDRA_PORT=${CASSANDRA_PORT:-9042}
KEYSPACE=${CASSANDRA_KEYSPACE:-viora_pluse_v1}
SCHEMA_FILE="db_schema/cassandra_reels_schema.cql"

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
echo "📝 Creating reels tables..."
if [ -f "$SCHEMA_FILE" ]; then
    cat "$SCHEMA_FILE" | cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -k $KEYSPACE
    echo " Schema created successfully"
else
    echo " Error: Schema file not found: $SCHEMA_FILE"
    exit 1
fi

# Verify tables were created
echo "🔍 Verifying tables..."
TABLES=$(cqlsh $CASSANDRA_HOST $CASSANDRA_PORT -k $KEYSPACE -e "DESCRIBE TABLES;" 2>/dev/null)

if echo "$TABLES" | grep -q "reel_views"; then
    echo " reel_views table created"
else
    echo "⚠️  Warning: reel_views table not found"
fi

echo ""
echo "🎉 Cassandra reels schema setup complete!"
echo ""
