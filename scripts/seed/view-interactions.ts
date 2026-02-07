import { pool } from "../../src/config/pg.config.js";
import * as fs from 'fs';
import * as path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

interface InteractionStats {
    totalFollows: number;
    totalLikes: number;
    totalComments: number;
    totalReplies: number;
    avgFollowersPerUser: number;
    avgFollowingPerUser: number;
    avgLikesPerPost: number;
    avgCommentsPerPost: number;
    topFollowedUsers: Array<{ user_id: number; username: string; followers_count: number }>;
    topLikedPosts: Array<{ post_id: string; likes_count: number; caption: string }>;
    topCommentedPosts: Array<{ post_id: string; comments_count: number; caption: string }>;
    mostActiveCommenters: Array<{ user_id: number; username: string; comments_count: number }>;
}

/**
 * Fetch comprehensive interaction statistics
 */
async function fetchInteractionStats(): Promise<InteractionStats> {
    const client = await pool.connect();
    try {
        // Total follows
        const followsResult = await client.query('SELECT COUNT(*) as count FROM follows');
        const totalFollows = parseInt(followsResult.rows[0].count);

        // Total likes (for posts only)
        const likesResult = await client.query("SELECT COUNT(*) as count FROM likes WHERE target_type = 'post'");
        const totalLikes = parseInt(likesResult.rows[0].count);

        // Total comments (excluding replies)
        const commentsResult = await client.query(
            'SELECT COUNT(*) as count FROM comments WHERE parent_comment_id IS NULL'
        );
        const totalComments = parseInt(commentsResult.rows[0].count);

        // Total replies
        const repliesResult = await client.query(
            'SELECT COUNT(*) as count FROM comments WHERE parent_comment_id IS NOT NULL'
        );
        const totalReplies = parseInt(repliesResult.rows[0].count);

        // Average followers per user
        const avgFollowersResult = await client.query(`
            SELECT AVG(follower_count)::numeric(10,2) as avg_followers
            FROM (
                SELECT COUNT(*) as follower_count
                FROM follows
                GROUP BY following_id
            ) as follower_counts
        `);
        const avgFollowersPerUser = parseFloat(avgFollowersResult.rows[0]?.avg_followers || '0');

        // Average following per user
        const avgFollowingResult = await client.query(`
            SELECT AVG(following_count)::numeric(10,2) as avg_following
            FROM (
                SELECT COUNT(*) as following_count
                FROM follows
                GROUP BY follower_id
            ) as following_counts
        `);
        const avgFollowingPerUser = parseFloat(avgFollowingResult.rows[0]?.avg_following || '0');

        // Average likes per post
        const avgLikesResult = await client.query(`
            SELECT AVG(likes_count)::numeric(10,2) as avg_likes
            FROM posts
        `);
        const avgLikesPerPost = parseFloat(avgLikesResult.rows[0]?.avg_likes || '0');

        // Average comments per post
        const avgCommentsResult = await client.query(`
            SELECT AVG(comments_count)::numeric(10,2) as avg_comments
            FROM posts
        `);
        const avgCommentsPerPost = parseFloat(avgCommentsResult.rows[0]?.avg_comments || '0');

        // Top 10 followed users
        const topFollowedResult = await client.query(`
            SELECT 
                up.user_id,
                up.username,
                up.followers_count
            FROM user_profiles up
            ORDER BY up.followers_count DESC
            LIMIT 10
        `);
        const topFollowedUsers = topFollowedResult.rows;

        // Top 10 liked posts
        const topLikedResult = await client.query(`
            SELECT 
                p.post_id,
                p.likes_count,
                COALESCE(SUBSTRING(p.caption, 1, 50), '[No caption]') as caption
            FROM posts p
            ORDER BY p.likes_count DESC
            LIMIT 10
        `);
        const topLikedPosts = topLikedResult.rows;

        // Top 10 commented posts
        const topCommentedResult = await client.query(`
            SELECT 
                p.post_id,
                p.comments_count,
                COALESCE(SUBSTRING(p.caption, 1, 50), '[No caption]') as caption
            FROM posts p
            ORDER BY p.comments_count DESC
            LIMIT 10
        `);
        const topCommentedPosts = topCommentedResult.rows;

        // Most active commenters
        const mostActiveCommentersResult = await client.query(`
            SELECT 
                up.user_id,
                up.username,
                COUNT(c.comment_id) as comments_count
            FROM user_profiles up
            JOIN comments c ON up.user_id = c.user_id
            GROUP BY up.user_id, up.username
            ORDER BY comments_count DESC
            LIMIT 10
        `);
        const mostActiveCommenters = mostActiveCommentersResult.rows;

        return {
            totalFollows,
            totalLikes,
            totalComments,
            totalReplies,
            avgFollowersPerUser,
            avgFollowingPerUser,
            avgLikesPerPost,
            avgCommentsPerPost,
            topFollowedUsers,
            topLikedPosts,
            topCommentedPosts,
            mostActiveCommenters
        };
    } finally {
        client.release();
    }
}

/**
 * Display interaction statistics in a formatted way
 */
function displayStats(stats: InteractionStats) {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║           VIORA INTERACTIONS OVERVIEW                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    // Overall Statistics
    console.log('📊 OVERALL STATISTICS');
    console.log('─────────────────────────────────────────────────────────────────');
    console.log(`  Total Follows:          ${stats.totalFollows.toLocaleString()}`);
    console.log(`  Total Likes:            ${stats.totalLikes.toLocaleString()}`);
    console.log(`  Total Comments:         ${stats.totalComments.toLocaleString()}`);
    console.log(`  Total Replies:          ${stats.totalReplies.toLocaleString()}`);
    console.log(`  Total Interactions:     ${(stats.totalFollows + stats.totalLikes + stats.totalComments + stats.totalReplies).toLocaleString()}\n`);

    // Averages
    console.log('📈 AVERAGE METRICS');
    console.log('─────────────────────────────────────────────────────────────────');
    console.log(`  Avg Followers/User:     ${stats.avgFollowersPerUser.toFixed(2)}`);
    console.log(`  Avg Following/User:     ${stats.avgFollowingPerUser.toFixed(2)}`);
    console.log(`  Avg Likes/Post:         ${stats.avgLikesPerPost.toFixed(2)}`);
    console.log(`  Avg Comments/Post:      ${stats.avgCommentsPerPost.toFixed(2)}\n`);

    // Top Followed Users
    console.log('👥 TOP 10 FOLLOWED USERS');
    console.log('─────────────────────────────────────────────────────────────────');
    stats.topFollowedUsers.forEach((user, idx) => {
        const username = user.username || `User${user.user_id}`;
        console.log(`  ${(idx + 1).toString().padStart(2)}. @${username.padEnd(20)} - ${user.followers_count.toLocaleString().padStart(6)} followers`);
    });
    console.log('');

    // Top Liked Posts
    console.log('❤️  TOP 10 LIKED POSTS');
    console.log('─────────────────────────────────────────────────────────────────');
    stats.topLikedPosts.forEach((post, idx) => {
        const caption = post.caption.length > 40 ? post.caption.substring(0, 40) + '...' : post.caption;
        console.log(`  ${(idx + 1).toString().padStart(2)}. ${post.likes_count.toLocaleString().padStart(6)} likes - "${caption}"`);
    });
    console.log('');

    // Top Commented Posts
    console.log('💬 TOP 10 COMMENTED POSTS');
    console.log('─────────────────────────────────────────────────────────────────');
    stats.topCommentedPosts.forEach((post, idx) => {
        const caption = post.caption.length > 40 ? post.caption.substring(0, 40) + '...' : post.caption;
        console.log(`  ${(idx + 1).toString().padStart(2)}. ${post.comments_count.toLocaleString().padStart(6)} comments - "${caption}"`);
    });
    console.log('');

    // Most Active Commenters
    console.log('🗣️  TOP 10 MOST ACTIVE COMMENTERS');
    console.log('─────────────────────────────────────────────────────────────────');
    stats.mostActiveCommenters.forEach((user, idx) => {
        const username = user.username || `User${user.user_id}`;
        console.log(`  ${(idx + 1).toString().padStart(2)}. @${username.padEnd(20)} - ${user.comments_count.toLocaleString().padStart(6)} comments`);
    });
    console.log('');
}

/**
 * Save statistics to a JSON file
 */
function saveStatsToFile(stats: InteractionStats) {
    const outputDir = path.join(__dirname, '../data/stats');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `interactions_stats_${timestamp}.json`);

    fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2));
    console.log(`\n💾 Statistics saved to: ${outputPath}\n`);
}

/**
 * Main function
 */
async function main() {
    console.log('Fetching interaction statistics...\n');

    try {
        const stats = await fetchInteractionStats();
        displayStats(stats);
        saveStatsToFile(stats);

        console.log('✅ Done!\n');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error fetching statistics:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { fetchInteractionStats, displayStats };
