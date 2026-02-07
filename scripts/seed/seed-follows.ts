import { baseUrl } from "../utils/get-base-url";
import axios from "axios";
import * as fs from 'fs';
import * as path from 'path';

import { activateAndRefreshUsers } from "../setup/activate-and-refresh-users";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Paths
const USERS_DATA_PATH = path.join(__dirname, '../data/auth/users_profile_data.json');
const PERF_OUTPUT_PATH = path.join(__dirname, `../performance/follows_insertion_performance_${new Date().toISOString().split('T')[0]}.txt`);

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

/**
 * Follow a user via HTTP request
 */
async function followUser(targetUserId: string, followerAccessToken: string): Promise<boolean> {
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${followerAccessToken}`
        };

        await axios.post(
            `${baseUrl}users/${targetUserId}/follow`,
            {},
            {
                headers,
                withCredentials: true,
            }
        );

        return true;
    } catch (err: any) {
        // Silently handle errors (user might already be following)
        const isDuplicate = err?.response?.status === 409 ||
            err?.response?.data?.message?.includes('duplicate key') ||
            err?.response?.data?.message?.includes('uk_follow_relationship');

        if (!isDuplicate) {
            console.error(`Error following user ${targetUserId}:`, err?.response?.data?.message || err?.message);
        }
        return false;
    }
}

/**
 * Generate follower distribution using power law (realistic social network distribution)
 * - Few users have many followers (influencers)
 * - Most users have moderate to few followers
 */
function generateFollowerDistribution(totalUsers: number): number[] {
    const distribution: number[] = [];

    // Power law parameters
    const alpha = 2.5; // Controls the steepness of the distribution

    for (let i = 0; i < totalUsers; i++) {
        // Rank from 1 to totalUsers (1 = most popular)
        const rank = i + 1;

        // Power law: followers ∝ 1 / rank^alpha
        // Scale to have max ~900 followers and min ~10 followers
        const maxFollowers = 900;
        const minFollowers = 10;

        const rawValue = 1 / Math.pow(rank, 1 / alpha);
        const normalized = (rawValue - 1 / Math.pow(totalUsers, 1 / alpha)) /
            (1 - 1 / Math.pow(totalUsers, 1 / alpha));

        const followers = Math.floor(minFollowers + normalized * (maxFollowers - minFollowers));
        distribution.push(Math.max(minFollowers, Math.min(maxFollowers, followers)));
    }

    return distribution;
}

/**
 * Main function to seed follows for all users
 * Creates realistic follower distribution (some users have many followers, most have fewer)
 */
export async function seedFollows() {
    console.log("Starting Follows Seeding...");

    // Ensure tokens are fresh and accounts are active
    await activateAndRefreshUsers(false);

    console.log("Creating realistic follower distribution (power law)...\n");
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
    console.log(`Found ${validUsers.length} users with valid tokens\n`);

    if (validUsers.length === 0) {
        console.error("No users with valid access tokens found!");
        return;
    }

    // 2. Generate follower distribution
    const followerCounts = generateFollowerDistribution(validUsers.length);

    // Show distribution stats
    const sorted = [...followerCounts].sort((a, b) => b - a);
    console.log("Follower Distribution:");
    console.log(`  Top 10 users: ${sorted.slice(0, 10).join(', ')} followers`);
    console.log(`  Median: ${sorted[Math.floor(sorted.length / 2)]} followers`);
    console.log(`  Bottom 10 users: ${sorted.slice(-10).join(', ')} followers`);
    console.log(`  Total follows to create: ${followerCounts.reduce((a, b) => a + b, 0)}\n`);

    let totalFollowsCreated = 0;
    let totalFollowsFailed = 0;

    const BATCH_SIZE = 10; // Process 10 follows concurrently (reduced to prevent deadlocks)

    // Fetch actual user IDs from database
    console.log("Fetching actual user IDs from database...");
    const { pool } = await import("../../src/config/pg.config.js");
    const client = await pool.connect();
    let userIdMap: Map<string, number>;
    try {
        const result = await client.query('SELECT user_id, email FROM users ORDER BY user_id');
        userIdMap = new Map(result.rows.map((row: any) => [row.email, row.user_id]));
        console.log(`Fetched ${userIdMap.size} user IDs from database\n`);
    } finally {
        client.release();
    }

    // Map users to their actual database IDs
    const usersWithIds = validUsers
        .map(u => ({ user: u, id: userIdMap.get(u.email) }))
        .filter(u => u.id !== undefined) as Array<{ user: UserData; id: number }>;

    console.log(`Mapped ${usersWithIds.length} users to database IDs\n`);

    // Process each user
    for (let userIdx = 0; userIdx < usersWithIds.length; userIdx++) {
        const { user: targetUser, id: targetUserId } = usersWithIds[userIdx];
        const numFollowers = followerCounts[userIdx];

        if (numFollowers === 0) {
            console.log(`User ${targetUserId} (${userIdx + 1}/${usersWithIds.length}): Skipping (0 followers)`);
            continue;
        }

        // Select random users to follow this user (excluding self)
        const potentialFollowers = usersWithIds.filter(({ id }) => id !== targetUserId);

        const shuffled = [...potentialFollowers].sort(() => Math.random() - 0.5);
        const followers = shuffled.slice(0, Math.min(numFollowers, potentialFollowers.length));

        console.log(`User ${targetUserId} (${userIdx + 1}/${usersWithIds.length}): Adding ${followers.length} followers...`);

        // Process follows in batches
        const totalBatches = Math.ceil(followers.length / BATCH_SIZE);

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const startIdx = batchIdx * BATCH_SIZE;
            const endIdx = Math.min(startIdx + BATCH_SIZE, followers.length);
            const batchFollowers = followers.slice(startIdx, endIdx);

            const batchPromises = batchFollowers.map(({ user }) =>
                followUser(String(targetUserId), user.accessToken)
            );
            const results = await Promise.all(batchPromises);

            const successCount = results.filter(r => r).length;
            const failCount = results.filter(r => !r).length;

            totalFollowsCreated += successCount;
            totalFollowsFailed += failCount;

            if (batchIdx % 5 === 0 || batchIdx === totalBatches - 1) {
                console.log(`  Batch ${batchIdx + 1}/${totalBatches}: ${successCount} succeeded, ${failCount} failed`);
            }

            // Small delay to reduce database pressure
            if (batchIdx < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log(`  ✓ User ${targetUserId} completed: ${followers.length} followers processed`);
    }

    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;

    const report = `
Follows Seeding Performance Report
-----------------------------------
Date: ${new Date().toISOString()}
Total Users Processed: ${usersWithIds.length}
Total Follows Created: ${totalFollowsCreated}
Total Follows Failed: ${totalFollowsFailed}
Total Time: ${durationSec.toFixed(2)}s
Avg Time per Follow: ${(durationSec / (totalFollowsCreated + totalFollowsFailed)).toFixed(4)}s
Follows per Second: ${((totalFollowsCreated + totalFollowsFailed) / durationSec).toFixed(2)}

Distribution Stats:
  Max Followers: ${Math.max(...followerCounts)}
  Min Followers: ${Math.min(...followerCounts)}
  Avg Followers: ${(followerCounts.reduce((a, b) => a + b, 0) / followerCounts.length).toFixed(2)}
-----------------------------------
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
    seedFollows()
        .then(() => {
            console.log("\nFollows seeding completed!");
            process.exit(0);
        })
        .catch((err) => {
            console.error("Follows seeding failed:", err);
            process.exit(1);
        });
}