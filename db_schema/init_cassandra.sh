#!/bin/bash

# Function to check if Cassandra is ready
wait_for_cassandra() {
    echo "Waiting for Cassandra to be ready at cassandra-server..."
    until cqlsh cassandra-server -e "DESCRIBE KEYSPACES" > /dev/null 2>&1; do
        sleep 5
        echo "Cassandra is unavailable - sleeping"
    done
    echo "Cassandra is up - executing command"
}

# Wait for Cassandra to start
wait_for_cassandra

# Execute CQL files
echo "Initializing Cassandra Schema..."
cqlsh cassandra-server -f /docker-entrypoint-initdb.d/00_init_keyspace.cql
cqlsh cassandra-server -k viora_pluse_v1 -f /docker-entrypoint-initdb.d/cassandra_feed_schema.cql
cqlsh cassandra-server -k viora_pluse_v1 -f /docker-entrypoint-initdb.d/cassandra_messenger_schema.cql
cqlsh cassandra-server -k viora_pluse_v1 -f /docker-entrypoint-initdb.d/cassandra_reels_schema.cql
cqlsh cassandra-server -k viora_pluse_v1 -f /docker-entrypoint-initdb.d/viora_analytics_schema.cql

echo "Cassandra Initialization Complete!"
