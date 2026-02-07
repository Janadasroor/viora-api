#!/bin/bash

# Configuration
FILE_ID="1T-k0oFKo5wKiezUA4YSb26lIjEDagB3W"
OUTPUT_FILE="public.zip"
TARGET_DIR="public"

echo "--- Viora Media Assets Downloader ---"

# Check for dependencies
if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed."
    exit 1
fi

if ! command -v unzip &> /dev/null; then
    echo "Error: unzip is not installed."
    exit 1
fi

echo "Downloading assets from Google Drive (ID: $FILE_ID)..."

# Step 1: Try to get the confirmation token (handles both URL and hidden input patterns)
TEMP_HTML="/tmp/gdrive_warning.html"
curl -sLc /tmp/gcookie "https://drive.google.com/uc?export=download&id=$FILE_ID" -o $TEMP_HTML

# Try pattern 1: confirm=XXX (common in links/text)
CONFIRM=$(grep -i -o 'confirm=[^&" <]*' $TEMP_HTML | head -n 1 | sed 's/[Cc][Oo][Nn][Ff][Ii][Rr][Mm]=//')

# Try pattern 2: name="confirm" value="XXX" (hidden input in form)
if [ -z "$CONFIRM" ]; then
    CONFIRM=$(sed -n 's/.*name="confirm" value="\([^"]*\)".*/\1/p' $TEMP_HTML | head -n 1)
fi

# Step 2: Download the file using the token
if [ -z "$CONFIRM" ]; then
    # Small file or couldn't get token, try direct download
    echo "Direct download attempt (no token found)..."
    curl -Lc /tmp/gcookie "https://drive.google.com/uc?export=download&id=$FILE_ID" -o $OUTPUT_FILE
else
    # Large file with confirmation
    echo "Large file detected, using confirmation token: $CONFIRM"
    # Note: Using drive.usercontent.google.com for large files often works better
    curl -Lb /tmp/gcookie "https://drive.usercontent.google.com/download?id=$FILE_ID&export=download&confirm=$CONFIRM" -o $OUTPUT_FILE
fi

# Cleanup temp HTML
rm -f $TEMP_HTML

# Step 3: Extract and cleanup
if [ -f "$OUTPUT_FILE" ]; then
    echo "Download complete. Extracting to $TARGET_DIR/..."
    mkdir -p $TARGET_DIR
    unzip -o $OUTPUT_FILE -d .
    
    echo "Cleaning up temporary files..."
    rm $OUTPUT_FILE
    rm /tmp/gcookie
    
    echo "Assets successfully installed in $TARGET_DIR/"
else
    echo "Error: Download failed!"
    exit 1
fi
