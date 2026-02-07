# Database Schema & Data

This directory contains the PostgreSQL and Cassandra schemas and sample data for the Viora platform.

## PostgreSQL

### Schema
- **viora_pluse_v1_schema_cleaned.sql**: Complete PostgreSQL schema including all tables, indexes, and constraints.

### Sample Data
- **viora_pluse_v1_data_cleaned.sql**: Sample data export (156MB) containing:
  - User accounts and profiles
  - Posts, comments, and interactions
  - Follows and relationships
  - Media metadata (file paths are placeholders - no actual media files)

### Restore Instructions

```bash
# Create database
createdb viora_pluse_v1

# Restore schema
psql viora_pluse_v1 < db_schema/viora_pluse_v1_schema_cleaned.sql

# Restore data
psql viora_pluse_v1 < db_schema/viora_pluse_v1_data_cleaned.sql
```

## Cassandra

### Schemas
- **cassandra_feed_schema.cql**: Feed caching and precomputation tables
- **cassandra_messenger_schema.cql**: Messaging system tables
- **cassandra_reels_schema.cql**: Reels analytics tables
- **viora_analytics_schema.cql**: Analytics and interaction tracking tables

### Setup Instructions

```bash
# Create keyspace and tables
cqlsh -f db_schema/cassandra_feed_schema.cql
cqlsh -f db_schema/cassandra_messenger_schema.cql
cqlsh -f db_schema/cassandra_reels_schema.cql
cqlsh -f db_schema/viora_analytics_schema.cql
```

## Docker Auto-Seeding

The `docker-compose.yml` configuration is set up to automatically seed the databases on the first run.

### PostgreSQL
- Mounts `viora_pluse_v1_schema_cleaned.sql` and `viora_pluse_v1_data_cleaned.sql` to `/docker-entrypoint-initdb.d/`.
- These scripts run automatically when the Postgres container is started for the first time with an empty data volume.

### Cassandra
- Uses a helper service `cassandra-init` that waits for Cassandra to be ready.
- Executes `init_cassandra.sh` which runs all CQL schema files.

### Qdrant
- Uses a helper service `qdrant-init` that waits for Qdrant to be ready.
- Executes `init_qdrant.sh` to create `posts` and `users` collections.

## Important Notes

⚠️ **Media Files**: The database contains metadata for media files, but the actual media files (images, videos) are NOT included in this repository. 

For development, you can quickly download and install all sample media (approx 1GB) using:

```bash
npm run assets:download
```

Alternatively:
- You can use the seeding scripts in `scripts/seed/` to generate test media
- Or update the media paths to point to your own test assets

## Data Cleaning

The `codeCleaner.py` script is used to sanitize SQL dumps by removing sensitive data before committing to version control.
