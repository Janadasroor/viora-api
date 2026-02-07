# Viora Seeding Scripts

This directory contains scripts to seed and view interactions data for the Viora social platform.

##  Available Scripts

###  Seeding Scripts (Create Data)

#### 1. **Seed All Interactions** (Recommended)
```bash
npx tsx scripts/seed/seed-all-interactions.ts
```
**What it does:** Runs all seeding scripts in sequence (follows → likes → comments)
- Creates realistic follower distributions (power law)
- Adds 0-1000 random likes per post
- Adds 0-50 random comments per post

#### 2. **Seed Follows Only**
```bash
npx tsx scripts/seed/seed-follows.ts
```
**What it does:** Creates follow relationships between users
- Uses power law distribution (some users have many followers, most have fewer)
- Top users get ~900 followers, average users get ~10-100 followers

#### 3. **Seed Likes Only**
```bash
npx tsx scripts/seed/seed-likes.ts
```
**What it does:** Adds random likes to posts
- Each post gets 0-1000 random likes from different users
- Processes in batches for performance

#### 4. **Seed Comments Only**
```bash
npx tsx scripts/seed/seed-comments.ts
```
**What it does:** Adds random comments to posts
- Each post gets 0-50 random comments from different users
- Uses realistic comment templates (emojis, short phrases)

---

###  Viewing Scripts (View Data)

#### **View All Interactions**
```bash
npx tsx scripts/seed/view-interactions.ts
```
**What it does:** Displays comprehensive statistics about all interactions
- Overall stats (total follows, likes, comments, replies)
- Average metrics (avg followers/user, avg likes/post, etc.)
- Top 10 followed users
- Top 10 liked posts
- Top 10 commented posts
- Top 10 most active commenters
- Saves results to JSON file

---

##  Quick Start

### To seed everything from scratch:
```bash
# 1. Seed all interactions (this will take a while)
npx tsx scripts/seed/seed-all-interactions.ts

# 2. View the results
npx tsx scripts/seed/view-interactions.ts
```

---

##  Performance

All seeding scripts include:
-  Batch processing for optimal performance
-  Progress logging
-  Performance reports saved to `scripts/performance/`
-  Error handling and retry logic

---

##  Output Files

- **Performance Reports:** `scripts/performance/`
  - `follows_insertion_performance_YYYY-MM-DD.txt`
  - `likes_insertion_performance_YYYY-MM-DD.txt`
  - `comments_insertion_performance_YYYY-MM-DD.txt`

- **Statistics:** `scripts/data/stats/`
  - `interactions_stats_YYYY-MM-DDTHH-MM-SS.json`

---

##  Configuration

All scripts use:
- User data from: `scripts/data/auth/users_profile_data.json`
- Base URL from: `scripts/utils/get-base-url.ts`
- Database config from: `src/config/pg.config.ts`

---

##  Troubleshooting

### "No users with valid access tokens found"
Run the activation script first:
```bash
npx tsx scripts/setup/activate-and-refresh-users.ts
```

### "No posts found in database"
Seed posts first:
```bash
npx tsx scripts/seed/seed-posts.ts
```

---

##  Notes

- All seeding scripts automatically refresh user tokens before running
- Scripts can be run multiple times (duplicates are handled gracefully)
- Batch sizes are optimized for performance (50-100 concurrent operations)
- Random distributions ensure realistic social network patterns
