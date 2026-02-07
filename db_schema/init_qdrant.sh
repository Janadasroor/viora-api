#!/bin/bash

QDRANT_HOST="qdrant-server"
QDRANT_PORT="6333"

# Function to check if Qdrant is ready
wait_for_qdrant() {
    echo "Waiting for Qdrant to be ready..."
    until curl -s "http://$QDRANT_HOST:$QDRANT_PORT/collections" > /dev/null; do
        sleep 5
        echo "Qdrant is unavailable - sleeping"
    done
    echo "Qdrant is up - configuring collections"
}

restore_snapshot() {
    local name=$1
    local snapshot_file="/init-scripts/qdrant_snapshots/${name}.snapshot"
    
    if [ ! -f "$snapshot_file" ]; then
        echo "Snapshot file not found: $snapshot_file"
        return
    fi

    # Check if collection exists
    if curl -s "http://$QDRANT_HOST:$QDRANT_PORT/collections/$name" | grep -q "\"status\":\"ok\""; then
        echo "Collection $name already exists - skipping restore"
    else
        echo "Restoring collection: $name from snapshot..."
        # Use Qdrant's snapshot recovery API (via multipart upload or dedicated endpoint)
        # Note: Qdrant restore from uploaded snapshot is complex via curl.
        # Simpler approach: copying snapshot to storage manually or using special endpoint 
        # For simplicity in this script, we assume the snapshot is available to Qdrant instance
        # if mounted to /qdrant/snapshots, but here we are in a separate container.
        
        # Proper way: POST /collections/{collection_name}/snapshots/upload
        curl -X POST "http://$QDRANT_HOST:$QDRANT_PORT/collections/$name/snapshots/upload?priority=snapshot" \
            -H "Content-Type: multipart/form-data" \
            -F "snapshot=@$snapshot_file"
            
        echo "Restore initiated for $name"
    fi
}

# Wait for Qdrant
wait_for_qdrant

# Restore Collections
restore_snapshot "media_embeddings"
restore_snapshot "media_embeddings_legacy_512"
restore_snapshot "media_embeddings_v2"
restore_snapshot "post_caption_embeddings"

echo "Qdrant Initialization Complete!"
