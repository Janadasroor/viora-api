import { pool } from "../src/config/pg.config.js";
import feedRepository from "../src/repositories/FeedRepository.ts";
import redisService from "../src/cache/RedisService.ts";
import intractionsService from "../src/services/InteractionsService.ts";
import { sInfo } from "sk-logger";

async function testFeedFreshness() {
    const userId = "3311";
    sInfo("--- Starting Feed Freshness Test ---");

    // 1. Clear seen posts for clean start
    await pool.query('DELETE FROM likes WHERE user_id = $1', [userId]);
    // Note: We can't easily clear Redis sets without a specific method, but we can just use a new user if needed.
    // Let's assume user 3311 is okay for now.

    sInfo("Fetching initial feed...");
    const feed1 = await feedRepository.getFeed(1, 10, userId, 5, 1, true); // Refresh
    const initialIds = feed1.posts.map(p => p.postId);
    sInfo(`Initial Feed IDs: ${initialIds.slice(0, 5).join(', ')}...`);

    // 2. Mark top 3 as seen
    const toMarkSeen = initialIds.slice(0, 3);
    sInfo(`Marking posts as seen: ${toMarkSeen.join(', ')}`);
    await redisService.markPostsAsSeen(userId, toMarkSeen);

    // 3. Like the 4th post
    const toLike = initialIds[3];
    sInfo(`Liking post: ${toLike}`);
    await intractionsService.likePost(toLike, userId);

    // 4. Fetch feed again (should be fallback or new cache)
    sInfo("Fetching refreshed feed...");
    const feed2 = await feedRepository.getFeed(1, 10, userId, 5, 1, true); // Refresh
    const newIds = new Set(feed2.posts.map(p => p.postId));

    sInfo("Verifying freshness...");

    let failed = false;
    toMarkSeen.forEach(id => {
        if (newIds.has(id)) {
            console.error(`FAIL: Seen post ${id} still in feed!`);
            failed = true;
        }
    });

    if (newIds.has(toLike)) {
        console.error(`FAIL: Liked post ${toLike} still in feed!`);
        failed = true;
    }

    if (!failed) {
        sInfo("PASS: Feed is fresh! Seen and Liked posts were excluded.");
    }

    // 5. Check Diversity
    const authors = feed2.posts.map(p => p.userId);
    const uniqueAuthors = new Set(authors);
    sInfo(`Author diversity: ${uniqueAuthors.size} unique authors in ${authors.length} posts.`);

    let clusterCount = 0;
    for (let i = 0; i < authors.length - 1; i++) {
        if (authors[i] === authors[i + 1]) clusterCount++;
    }

    if (clusterCount > 0) {
        console.warn(`WARNING: Found ${clusterCount} same-author clusters.`);
    } else {
        sInfo("PASS: No same-author clusters found.");
    }

    await pool.end();
    process.exit(0);
}

testFeedFreshness().catch(err => {
    console.error(err);
    process.exit(1);
});
