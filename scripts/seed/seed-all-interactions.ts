import { seedFollows } from "./seed-follows.js";
import { seedLikes } from "./seed-likes.js";
import { seedComments } from "./seed-comments.js";

/**
 * Master script to seed all interactions (follows, likes, and comments)
 * Runs them sequentially to avoid overwhelming the server
 */
async function seedAllInteractions() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║        VIORA INTERACTIONS SEEDING - MASTER SCRIPT             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const totalStartTime = performance.now();

    try {
        // Step 1: Seed Follows
        console.log('\n🔹 STEP 1/3: Seeding Follows...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        await seedFollows();

        // Step 2: Seed Likes
        console.log('\n🔹 STEP 2/3: Seeding Likes...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        await seedLikes();

        // Step 3: Seed Comments
        console.log('\n🔹 STEP 3/3: Seeding Comments...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        await seedComments();

        const totalEndTime = performance.now();
        const totalDurationSec = (totalEndTime - totalStartTime) / 1000;
        const totalDurationMin = totalDurationSec / 60;

        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                  ALL SEEDING COMPLETED! ✅                    ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');
        console.log(`⏱️  Total Time: ${totalDurationMin.toFixed(2)} minutes (${totalDurationSec.toFixed(2)}s)`);
        console.log('\n📊 To view the results, run:');
        console.log('   npx tsx scripts/seed/view-interactions.ts\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Seeding failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    seedAllInteractions();
}

export { seedAllInteractions };
