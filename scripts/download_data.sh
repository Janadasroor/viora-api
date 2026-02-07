#!/bin/bash

# Configuration
FILE_ID="1bUbUOXkGm37wxGfvXiaiTM0erpCf4B8n"
OUTPUT_FILE="db_schema_assets.zip"
TARGET_DIR="db_schema"

echo "--- Viora Database Assets Downloader ---"

# Check for dependencies
if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed."
    exit 1
fi

if ! command -v unzip &> /dev/null; then
    echo "Error: unzip is not installed."
    exit 1
fi

echo "Downloading database assets from Google Drive (ID: $FILE_ID)..."

# Step 1: Try to get the confirmation token
TEMP_HTML="/tmp/gdrive_data_warning.html"
curl -sLc /tmp/gcookie_data "https://drive.google.com/uc?export=download&id=$FILE_ID" -o $TEMP_HTML

# Try pattern 1: confirm=XXX
CONFIRM=$(grep -i -o 'confirm=[^&" <]*' $TEMP_HTML | head -n 1 | sed 's/[Cc][Oo][Nn][Ff][Ii][Rr][Mm]=//')

# Try pattern 2: name="confirm" value="XXX"
if [ -z "$CONFIRM" ]; then
    CONFIRM=$(sed -n 's/.*name="confirm" value="\([^"]*\)".*/\1/p' $TEMP_HTML | head -n 1)
fi

# Step 2: Download the file using the token
if [ -z "$CONFIRM" ]; then
    echo "Direct download attempt (no token found)..."
    curl -Lc /tmp/gcookie_data "https://drive.google.com/uc?export=download&id=$FILE_ID" -o $OUTPUT_FILE
else
    echo "Large file detected, using confirmation token: $CONFIRM"
    curl -Lb /tmp/gcookie_data "https://drive.usercontent.google.com/download?id=$FILE_ID&export=download&confirm=$CONFIRM" -o $OUTPUT_FILE
fi

# Cleanup temp HTML
rm -f $TEMP_HTML

# Step 3: Extract and cleanup
if [ -f "$OUTPUT_FILE" ]; then
    echo "Download complete. Extracting to $TARGET_DIR/..."
    mkdir -p $TARGET_DIR
    unzip -o $OUTPUT_FILE -d $TARGET_DIR/
    
    echo "Cleaning up temporary files..."
    rm $OUTPUT_FILE
    rm /tmp/gcookie_data
    
    echo "Database assets successfully installed in $TARGET_DIR/"
else
    echo "Error: Download failed!"
    exit 1
fi
