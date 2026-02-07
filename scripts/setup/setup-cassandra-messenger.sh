#!/bin/bash

# Configuration
CASSANDRA_HOST=${CASSANDRA_HOST:-localhost}
CASSANDRA_PORT=${CASSANDRA_PORT:-9042}
KEYSPACE=${CASSANDRA_KEYSPACE:-viora_pluse_v1}
SCHEMA_FILE="db_schema/cassandra_messenger_schema.cql"

echo "🚀 Ensuring all Cassandra messenger tables exist..."

# Check if schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo " Error: Schema file not found: $SCHEMA_FILE"
    exit 1
fi

# Use cat and piping to bypass potential permission/file-access issues with cqlsh
echo "🔧 Applying schema from $SCHEMA_FILE to keyspace $KEYSPACE..."
cat "$SCHEMA_FILE" | cqlsh "$CASSANDRA_HOST" "$CASSANDRA_PORT" -k "$KEYSPACE"

if [ $? -eq 0 ]; then
    echo " Messenger schema applied successfully!"
else
    echo " Error: Failed to apply messenger schema."
    exit 1
fi

# Verify tables
echo "🔍 Verifying tables in $KEYSPACE..."
TABLES=$(cqlsh "$CASSANDRA_HOST" "$CASSANDRA_PORT" -k "$KEYSPACE" -e "DESCRIBE TABLES;" 2>/dev/null)

for table in conversations messages_by_conversation user_presence conversations_by_user; do
    if echo "$TABLES" | grep -q "$table"; then
        echo "   Table '$table' exists"
    else
        echo "  ⚠️  Warning: Table '$table' not found"
    fi
done

echo ""
echo "🎉 Setup complete!"
