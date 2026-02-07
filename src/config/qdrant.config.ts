
import { QdrantClient } from '@qdrant/js-client-rest';
import "dotenv/config";

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';

export const qdrantClient = new QdrantClient({
    url: qdrantUrl,
    checkCompatibility: false
});
