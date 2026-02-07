import { baseUrl } from "../utils/get-base-url";
import axios from "axios";
import * as fs from 'fs';
import * as path from 'path';
import { uploadImages } from "./seed-media";
import { activateAndRefreshUsers } from "../setup/activate-and-refresh-users";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
// Paths
const USERS_DATA_PATH = path.join(__dirname, '../data/auth/users_profile_data.json');
const VIORA_SEED_DATA_PATH = path.join(__dirname, '../seed/viora_seed_data.json');
const SEED_IMAGES_DIR = path.join(process.cwd(), 'scripts/assets/seed_media');
const PERF_OUTPUT_PATH = path.join(__dirname, '../performance/post_insertion_performance.txt');

// Ensure performance directory exists
if (!fs.existsSync(path.dirname(PERF_OUTPUT_PATH))) {
    fs.mkdirSync(path.dirname(PERF_OUTPUT_PATH), { recursive: true });
}

interface SeedItem {
    path: string;
    caption: string;
    category: string;
    location?: string;
}

const ATTEMPTS_PER_USER = 1;
interface CreatePostRequest {
    caption: string;
    visibility: string;
    location?: string | null;
    hashtags?: any;
}

interface CreatePostResponse {
    postId: string;
}

export async function createPost(
    request: CreatePostRequest,
    accessToken?: string
): Promise<CreatePostResponse | null> {
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const res = await axios.post(
            `${baseUrl}posts`,
            request,
            {
                headers,
                withCredentials: true,
            }
        );

        return res.data.data;
    } catch (err: any) {
        console.error("Error creating post:", err?.message);
        return null;
    }
}

/**
 * Main function to seed 10,000 posts (10 per user, using recycled images).
 * Does NOT run automatically. Call via another script or REPL.
 */
export async function seedPosts() {
    console.log("Starting Post Seeding with AI content...");

    // Ensure tokens are fresh and accounts are active
    await activateAndRefreshUsers(false);

    const startTime = performance.now();

    // 1. Load User Data
    if (!fs.existsSync(USERS_DATA_PATH)) {
        console.error("Users data not found at:", USERS_DATA_PATH);
        return;
    }
    const users = JSON.parse(fs.readFileSync(USERS_DATA_PATH, 'utf-8'));

    // 2. Load Seed Data (viora_seed_data.json)
    if (!fs.existsSync(VIORA_SEED_DATA_PATH)) {
        console.error("Seed data not found at:", VIORA_SEED_DATA_PATH);
        console.error("Please run download-media.ts and generate-caption.ts first.");
        return;
    }
    const seedItems: SeedItem[] = JSON.parse(fs.readFileSync(VIORA_SEED_DATA_PATH, 'utf-8'));
    const TOTAL_USERS = users.length;
    // const TOTAL_POSTS = TOTAL_USERS * ATTEMPTS_PER_USER; 
    const TOTAL_POSTS = 1000;
    console.log(`Found ${seedItems.length} seed items and ${TOTAL_USERS} users.`);
    console.log(`Targeting ${TOTAL_POSTS} posts (limited for testing).`);

    let createdCount = 0;
    let mediaUploadCount = 0;

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(TOTAL_POSTS / BATCH_SIZE);

    console.log(`Starting batched seeding with batch size ${BATCH_SIZE}...`);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const startIdx = batchIdx * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, TOTAL_POSTS);

        const batchPromises = [];

        for (let i = startIdx; i < endIdx; i++) {
            batchPromises.push((async () => {
                const userIndex = Math.floor(i / ATTEMPTS_PER_USER);
                const seedIndex = i % seedItems.length;
                const seedItem = seedItems[seedIndex];
                const user = users[userIndex];

                if (!user || !user.accessToken) {
                    return;
                }

                // Create Post
                const postReq: CreatePostRequest = {
                    caption: seedItem.caption,
                    visibility: 'public',
                    location: seedItem.location || null,
                    hashtags: [`#${seedItem.category.replace(/\s+/g, '')}`, '#viora', '#seed'],
                };

                const postRes = await createPost(postReq, user.accessToken);

                if (postRes && postRes.postId) {
                    createdCount++;
                    // Upload Media
                    const filePath = path.join(SEED_IMAGES_DIR, seedItem.path);
                    if (fs.existsSync(filePath)) {
                        const fileBuffer = fs.readFileSync(filePath);
                        const file = new File([fileBuffer], seedItem.path, { type: 'image/jpeg' });

                        try {
                            const uploadRes = await uploadImages({
                                files: [file],
                                targetId: String(postRes.postId),
                                targetType: 'POST',
                                accessToken: user.accessToken
                            });
                            if (uploadRes && uploadRes.success !== false) {
                                mediaUploadCount++;
                            }
                        } catch (mediaErr) {
                            console.error(`Media upload error post ${postRes.postId}:`, mediaErr);
                        }
                    }
                }
            })());
        }

        await Promise.all(batchPromises);
        console.log(`Processed batch ${batchIdx + 1}/${totalBatches} (${endIdx}/${TOTAL_POSTS} posts)...`);
    }

    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;

    const report = `
Post Seeding Performance Report
--------------------------------
Date: ${new Date().toISOString()}
Total Posts Attempted: ${TOTAL_POSTS}
Total Posts Created: ${createdCount}
Total Media Uploaded: ${mediaUploadCount}
Total Time: ${durationSec.toFixed(2)}s
Avg Time per Post: ${(durationSec / TOTAL_POSTS).toFixed(4)}s
--------------------------------
`;
    console.log(report);
    fs.writeFileSync(PERF_OUTPUT_PATH, report);

    // Cleanup resources
    const { pool } = await import('../../src/config/pg.config.js');
    const { default: redisClient } = await import('../../src/config/redis.config.js');
    await pool.end();
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
    seedPosts().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
