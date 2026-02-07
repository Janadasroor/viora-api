
import { pool } from "../src/config/pg.config";
import feedRepository from "../src/repositories/FeedRepository";
import { sLog } from "sk-logger";

async function testFeedDiversity() {
    const userId = "3311"; // Follower of 3049
    const limit = 20;

    console.log(`Fetching feed for user ${userId}...`);
    const result = await feedRepository.getFeed(1, limit, userId, 5, 1, true); // Force refresh

    const authorCounts: Record<string, number> = {};

    result.posts.forEach(p => {
        const authorId = p.userId;
        authorCounts[authorId] = (authorCounts[authorId] || 0) + 1;
    });

    console.log("Feed Author Distribution:");
    console.table(authorCounts);

    const sortedAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]);
    if (sortedAuthors.length > 0 && sortedAuthors[0][1] > limit * 0.5) {
        console.error("FAIL: Single author dominates feed!");
        console.log(`Dominant author: ${sortedAuthors[0][0]} with ${sortedAuthors[0][1]} posts`);
    } else {
        console.log("PASS: Feed looks diverse.");
    }

    // Also check the source of these posts
    const sources: Record<string, number> = {};
    result.posts.forEach(p => {
        const source = p.feedMetadata?.source || 'unknown';
        sources[source] = (sources[source] || 0) + 1;
    });
    console.log("Feed Source Distribution:");
    console.table(sources);

    await pool.end();
}

testFeedDiversity().catch(console.error);
