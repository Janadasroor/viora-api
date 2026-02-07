import { baseUrl } from "../utils/get-base-url";
import axios from "axios";
import * as fs from 'fs';
import * as path from 'path';
import { pool } from "../../src/config/pg.config.js";

import { activateAndRefreshUsers } from "../setup/activate-and-refresh-users";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Paths
const USERS_DATA_PATH = path.join(__dirname, '../data/auth/users_profile_data.json');
const PERF_OUTPUT_PATH = path.join(__dirname, `../performance/likes_insertion_performance_${new Date().toISOString().split('T')[0]}.txt`);

interface UserData {
    name: string;
    username: string;
    email: string;
    password: string;
    accessToken: string;
    refreshToken: string;
    accountStatus: string;
    creationTimeMs: string;
    createdAt: string;
}

interface Post {
    post_id: string;
}

/**
 * Like a post via HTTP request
 */
let totalTime = 0;
async function likePost(postId: string, accessToken: string): Promise<boolean> {
    try {
        const startTime = performance.now();
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        };

        await axios.post(
            `${baseUrl}interactions/posts/${postId}/like`,
            {},
            {
                headers,
                withCredentials: true,
            }
        );

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        totalTime += duration;
        return true;
    } catch (err: any) {
        // Silently handle errors (user might have already liked the post)
        if (err?.response?.status !== 409) { // 409 = already liked
            console.error(`Error liking post ${postId}:`, err?.response?.data?.message || err?.message);
        }
        return false;
    }
}

/**
 * Fetch all posts from the database
 */
async function fetchAllPosts(): Promise<Post[]> {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT post_id FROM posts ORDER BY post_id');
        return result.rows;
    } catch (error) {
        console.error('Error fetching posts:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Main function to seed likes for all posts
 * Each post gets 0-1000 random likes from different users
 */
export async function seedLikes() {
    console.log("Starting Likes Seeding...");

    // Ensure tokens are fresh and accounts are active
    await activateAndRefreshUsers(false);

    const startTime = performance.now();

    // 1. Load user data
    if (!fs.existsSync(USERS_DATA_PATH)) {
        console.error("Users data not found at:", USERS_DATA_PATH);
        return;
    }
    const users: UserData[] = JSON.parse(fs.readFileSync(USERS_DATA_PATH, 'utf-8'));
    console.log(`Loaded ${users.length} users`);

    // Filter users with valid access tokens
    const validUsers = users.filter(u => u.accessToken && u.accessToken.length > 0);
    console.log(`Found ${validUsers.length} users with valid tokens`);

    if (validUsers.length === 0) {
        console.error("No users with valid access tokens found!");
        return;
    }

    // 2. Fetch all posts from database
    console.log("Fetching posts from database...");
    const posts = await fetchAllPosts();
    console.log(`Found ${posts.length} posts in database`);

    if (posts.length === 0) {
        console.warn("No posts found in database!");
        return;
    }

    let totalLikesCreated = 0;
    let totalLikesFailed = 0;

    const BATCH_SIZE = 10; // Process 10 likes concurrently (reduced to prevent deadlocks)

    // Process each post
    for (let postIdx = 0; postIdx < posts.length; postIdx++) {
        const post = posts[postIdx];
        const postId = post.post_id;

        // Random number of likes between 0 and 1000
        const numLikes = Math.floor(Math.random() * 1001);

        if (numLikes === 0) {
            console.log(`Post ${postId} (${postIdx + 1}/${posts.length}): Skipping (0 likes)`);
            continue;
        }

        // Shuffle users and pick random subset
        const shuffledUsers = [...validUsers].sort(() => Math.random() - 0.5);
        const usersToLike = shuffledUsers.slice(0, Math.min(numLikes, validUsers.length));

        console.log(`Post ${postId} (${postIdx + 1}/${posts.length}): Adding ${usersToLike.length} likes...`);

        // Process likes in batches
        const totalBatches = Math.ceil(usersToLike.length / BATCH_SIZE);

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const startIdx = batchIdx * BATCH_SIZE;
            const endIdx = Math.min(startIdx + BATCH_SIZE, usersToLike.length);
            const batchUsers = usersToLike.slice(startIdx, endIdx);

            const batchPromises = batchUsers.map(user => likePost(postId, user.accessToken));
            const results = await Promise.all(batchPromises);

            const successCount = results.filter(r => r).length;
            const failCount = results.filter(r => !r).length;

            totalLikesCreated += successCount;
            totalLikesFailed += failCount;

            if (batchIdx % 5 === 0 || batchIdx === totalBatches - 1) {
                console.log(`  Batch ${batchIdx + 1}/${totalBatches}: ${successCount} succeeded, ${failCount} failed`);
            }

            // Small delay to reduce database pressure
            if (batchIdx < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log(`  ✓ Post ${postId} completed: ${usersToLike.length} likes processed`);
    }

    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;

    const report = `
Likes Seeding Performance Report
---------------------------------
Date: ${new Date().toISOString()}
Total Posts Processed: ${posts.length}
Total Likes Created: ${totalLikesCreated}
Total Likes Failed: ${totalLikesFailed}
Total Time: ${durationSec.toFixed(2)}s
Avg Time per Like: ${(durationSec / (totalLikesCreated + totalLikesFailed)).toFixed(4)}s
---------------------------------
`;
    console.log(report);
    console.log(`Total time: ${totalTime.toFixed(2)}s`);
    // Ensure performance directory exists
    const perfDir = path.dirname(PERF_OUTPUT_PATH);
    if (!fs.existsSync(perfDir)) {
        fs.mkdirSync(perfDir, { recursive: true });
    }

    fs.writeFileSync(PERF_OUTPUT_PATH, report);
    console.log(`Performance report saved to: ${PERF_OUTPUT_PATH}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    seedLikes()
        .then(() => {
            console.log("Likes seeding completed!");
            process.exit(0);
        })
        .catch((err) => {
            console.error("Likes seeding failed:", err);
            process.exit(1);
        });
}
