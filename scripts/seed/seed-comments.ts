import { baseUrl } from "../utils/get-base-url";
import axios from "axios";
import * as fs from 'fs';
import * as path from 'path';
import { pool } from "../../src/config/pg.config.js";

import { activateAndRefreshUsers } from "../setup/activate-and-refresh-users";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Paths
const USERS_DATA_PATH = path.join(__dirname, '../data/auth/users_profile_data.json');
const PERF_OUTPUT_PATH = path.join(__dirname, `../performance/comments_insertion_performance_${new Date().toISOString().split('T')[0]}.txt`);

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

// Sample comment templates
const COMMENT_TEMPLATES = [
    "Amazing! 🔥",
    "Love this! ❤️",
    "So beautiful! 😍",
    "Incredible work!",
    "This is awesome! 👏",
    "Great shot! 📸",
    "Stunning! ✨",
    "Wow! 🤩",
    "Perfect! 💯",
    "Beautiful! 🌟",
    "Nice! 👍",
    "Awesome content!",
    "Love it! 💕",
    "This is fire! 🔥🔥",
    "So cool! 😎",
    "Fantastic! 🎉",
    "Brilliant! 💡",
    "Gorgeous! 🌺",
    "Impressive! 👌",
    "Outstanding! 🏆",
    "This made my day! 😊",
    "Can't stop looking at this! 👀",
    "Goals! 🎯",
    "Absolutely stunning!",
    "Keep it up! 💪",
    "You're killing it! 🙌",
    "This is everything! ✨",
    "Obsessed! 😍😍",
    "Pure magic! ✨🪄",
    "Vibes! ✌️",
    "Legend! 🔥",
    "Masterpiece! 🎨",
    "Perfection! 💎",
    "Iconic! 👑",
    "This is art! 🖼️",
    "Breathtaking! 🌅",
    "So aesthetic! 🌸",
    "Living for this! 💖",
    "Need more of this! 🙏",
    "This hits different! 💫",
    "Absolutely love this vibe! 🌈",
    "You never disappoint! 🌟",
    "This is why I'm here! 👏",
    "Can we talk about how amazing this is? 😱",
    "Saved! 📌",
    "Sharing this! 🔄",
    "Tag me in more like this! 🏷️",
    "This deserves all the love! ❤️‍🔥",
    "You're so talented! 🎭",
    "How do you do it? 🤔✨"
];

/**
 * Post a comment on a post via HTTP request
 */
async function commentOnPost(postId: string, content: string, accessToken: string): Promise<boolean> {
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        };

        await axios.post(
            `${baseUrl}comments/posts/${postId}/comments`,
            { content },
            {
                headers,
                withCredentials: true,
            }
        );

        return true;
    } catch (err: any) {
        // Silently handle errors
        if (err?.response?.status !== 409) {
            console.error(`Error commenting on post ${postId}:`, err?.response?.data?.message || err?.message);
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
 * Get a random comment from templates
 */
function getRandomComment(): string {
    return COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)];
}

/**
 * Main function to seed comments for all posts
 * Each post gets 0-50 random comments from different users
 */
export async function seedComments() {
    console.log("Starting Comments Seeding...");

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
    console.log(`Found ${posts.length} posts in database\n`);

    if (posts.length === 0) {
        console.warn("No posts found in database!");
        return;
    }

    let totalCommentsCreated = 0;
    let totalCommentsFailed = 0;

    const BATCH_SIZE = 10; // Process 10 comments concurrently (reduced to prevent deadlocks)

    // Process each post
    for (let postIdx = 0; postIdx < posts.length; postIdx++) {
        const post = posts[postIdx];
        const postId = post.post_id;

        // Random number of comments between 0 and 50
        const numComments = Math.floor(Math.random() * 51);

        if (numComments === 0) {
            console.log(`Post ${postId} (${postIdx + 1}/${posts.length}): Skipping (0 comments)`);
            continue;
        }

        // Shuffle users and pick random subset
        const shuffledUsers = [...validUsers].sort(() => Math.random() - 0.5);
        const usersToComment = shuffledUsers.slice(0, Math.min(numComments, validUsers.length));

        console.log(`Post ${postId} (${postIdx + 1}/${posts.length}): Adding ${usersToComment.length} comments...`);

        // Process comments in batches
        const totalBatches = Math.ceil(usersToComment.length / BATCH_SIZE);

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const startIdx = batchIdx * BATCH_SIZE;
            const endIdx = Math.min(startIdx + BATCH_SIZE, usersToComment.length);
            const batchUsers = usersToComment.slice(startIdx, endIdx);

            const batchPromises = batchUsers.map(user => {
                const comment = getRandomComment();
                return commentOnPost(postId, comment, user.accessToken);
            });
            const results = await Promise.all(batchPromises);

            const successCount = results.filter(r => r).length;
            const failCount = results.filter(r => !r).length;

            totalCommentsCreated += successCount;
            totalCommentsFailed += failCount;

            if (batchIdx % 5 === 0 || batchIdx === totalBatches - 1) {
                console.log(`  Batch ${batchIdx + 1}/${totalBatches}: ${successCount} succeeded, ${failCount} failed`);
            }

            // Small delay to reduce database pressure
            if (batchIdx < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log(`  ✓ Post ${postId} completed: ${usersToComment.length} comments processed`);
    }

    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;

    const report = `
Comments Seeding Performance Report
------------------------------------
Date: ${new Date().toISOString()}
Total Posts Processed: ${posts.length}
Total Comments Created: ${totalCommentsCreated}
Total Comments Failed: ${totalCommentsFailed}
Total Time: ${durationSec.toFixed(2)}s
Avg Time per Comment: ${(durationSec / (totalCommentsCreated + totalCommentsFailed)).toFixed(4)}s
Comments per Second: ${((totalCommentsCreated + totalCommentsFailed) / durationSec).toFixed(2)}
------------------------------------
`;
    console.log(report);

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
    seedComments()
        .then(() => {
            console.log("\nComments seeding completed!");
            process.exit(0);
        })
        .catch((err) => {
            console.error("Comments seeding failed:", err);
            process.exit(1);
        });
}
