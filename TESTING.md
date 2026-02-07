# Testing & Data Seeding Guide

This guide explains how to populate the Viora Server with realistic test data ("legal data" collected from public APIs and AI generators) to ensure a robust testing environment.

## 📂 Scripts Overview

The `scripts/` directory contains utilities to fetch real-world media, generate AI assets, and seed the database with users and posts.

### 1. Data Collection (Web Scraping / APIs)

These scripts fetch external data to make your local environment look realistic.

#### `scripts/utils/download-media.ts`
**Purpose**: Downloads royalty-free images and videos from **Pexels API** based on search queries defined in `scripts/data/search/search_queries.json`.
- **Requires**: `PEXELS_API_KEY` in your `.env` file.
- **Usage**:
  ```bash
  # Download images/videos to assets/ folder
  npx tsx scripts/utils/download-media.ts
  ```

#### `scripts/utils/generate-images.ts`
**Purpose**: Generates unique, copyright-free AI profile pictures for users using **Pollinations.ai**.
- **Usage**:
  ```bash
  # Generates images into assets/images/people/
  npx tsx scripts/utils/generate-images.ts
  ```

---

### 2. Database Seeding

Once you have collected the media assets, use these scripts to populate the database.

#### `scripts/seed/seed-users.ts`
**Purpose**: Creates a bulk set of user accounts (default: 1000 users).
- Uses names from `scripts/data/users/random-names.txt`.
- Generates valid emails, usernames, and passwords.
- **Usage**:
  ```bash
  npx tsx scripts/seed/seed-users.ts
  ```

#### `scripts/seed/seed-posts.ts`
**Purpose**: Creates posts for the seeded users.
- Uses captions and locations from `scripts/data/posts_data.json`.
- Attaches the downloaded media (from Pexels) to the posts.
- **Usage**:
  ```bash
  # Ensure you run seed-users.ts first!
  npx tsx scripts/seed/seed-posts.ts
  ```

---

## 🚀 Full Testing Workflow

To set up a fully populated test environment from scratch:

1.  **Configure Environment**:
    Ensure your `.env` has a valid `PEXELS_API_KEY`.

2.  **Collect Data**:
    ```bash
    # 1. Fetch real media
    npx tsx scripts/utils/download-media.ts
    
    # 2. Generate profile pics
    npx tsx scripts/utils/generate-images.ts
    ```

3.  **Seed Database**:
    ```bash
    # 3. Create Users
    npx tsx scripts/seed/seed-users.ts
    
    # 4. Create Content
    npx tsx scripts/seed/seed-posts.ts
    ```

4.  **Run Tests**:
    Now your backend has thousands of users and posts with real images, ready for load testing or frontend integration.
