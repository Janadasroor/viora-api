
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Stream } from 'stream';
import { promisify } from 'util';

const finished = promisify(Stream.finished);

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const SNAPSHOT_DIR = path.resolve(__dirname, '../db_schema/qdrant_snapshots');

const COLLECTIONS = ['media_embeddings', 'media_embeddings_legacy_512', 'media_embeddings_v2', 'post_caption_embeddings'];

async function createSnapshot(collectionName: string) {
    try {
        console.log(`Creating snapshot for collection: ${collectionName}...`);

        // 1. Trigger snapshot creation
        const createRes = await axios.post(`${QDRANT_URL}/collections/${collectionName}/snapshots`);
        const snapshotName = createRes.data.result.name;

        if (!snapshotName) {
            throw new Error(`Failed to get snapshot name from response: ${JSON.stringify(createRes.data)}`);
        }

        console.log(`Snapshot created remotely: ${snapshotName}`);

        // 2. Download snapshot
        const downloadUrl = `${QDRANT_URL}/collections/${collectionName}/snapshots/${snapshotName}`;
        const outputPath = path.join(SNAPSHOT_DIR, `${collectionName}.snapshot`);

        console.log(`Downloading snapshot from ${downloadUrl} to ${outputPath}...`);

        const writer = fs.createWriteStream(outputPath);
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream',
        });

        response.data.pipe(writer);
        await finished(writer);

        console.log(`Snapshot saved to ${outputPath}`);

    } catch (error: any) {
        if (error.response?.status === 404) {
            console.warn(`Collection '${collectionName}' not found. Skipping.`);
        } else {
            console.error(`Error processing collection ${collectionName}:`, error.message);
        }
    }
}

async function main() {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    for (const collection of COLLECTIONS) {
        await createSnapshot(collection);
    }
}

main().catch(console.error);
