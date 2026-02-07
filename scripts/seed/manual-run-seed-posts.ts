import { seedPosts } from "./seed-posts";

// Execute the seeding process
seedPosts().then(() => {
    console.log("Seeding process initiated.");
}).catch((err) => {
    console.error("Seeding process encountered an error:", err);
});
