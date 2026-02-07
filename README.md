# Viora Server TS

## Overview
Viora Server is the backend API for the Viora social platform. It is built with Node.js, Express, and TypeScript, following a layered architecture pattern to ensure scalability, maintainability, and separation of concerns.

**Repository:** [https://github.com/Janadasroor/viora-api](https://github.com/Janadasroor/viora-api)

## Viora Ecosystem

This repository is part of the larger Viora ecosystem. Check out our client applications:
- **Web App:** [viora-web](https://github.com/Janadasroor/viora-web) (Next.js)
- **Android App:** [viora-android](https://github.com/Janadasroor/viora-android) (Native Android/Kotlin)
- **Documentation:** [viora-docs](https://github.com/Janadasroor/viora-docs) (Developer Guides)

## Architecture

The system follows a standard **Controller-Service-Repository** pattern, augmented with an asynchronous **Job Queue** system for heavy background processing (media encoding, notifications, complex interactions).

### 1. High-Level Request Flow
Standard API requests (e.g., fetching a profile) follow this synchronous path:

![High-Level Request Flow](docs/images/request-flow.png)

### 2. Media Upload & Processing Flow
Requests involving media (Posts, Reels, Stories) offload processing to background workers:

![Media Upload & Processing Flow](docs/images/media-flow.png)

### 3. Interactions Flow
High-volume interactions (Likes, Comments) are processed asynchronously to maintain performance:

![Interactions Flow](docs/images/interaction-flow.png)

## Core Components

The codebase is organized into semantic directories in `src/`:

| Directory | Role |
|-----------|------|
| **`routes/`** | Defines API endpoints and mounts middlewares. Routes delegate requests to Controllers. |
| **`validators/`** | Contains Zod schemas to validate incoming request bodies, params, and queries before they reach the Controller. |
| **`controllers/`** | Handles HTTP request/response lifecycle. extracts data, calls Services, and formats responses. |
| **`services/`** | Contains business logic. Orchestrates data operations, calls Repositories, and manages Job Queues. |
| **`repositories/`** | Direct database access layer. Executes SQL queries and returns typed data models. |
| **`jobs/`** | **Queues**: Definitions of BullMQ queues.<br>**Workers**: Processor functions that handle background jobs (Media processing, etc.). |

## Application Requirements

To run this backend, you need the following services:
- **Node.js** (Runtime)
- **Docker** (For containerizing databases)
- **PostgreSQL** (Primary Database)
- **Redis** (Queue Management)
- **Cassandra** (High-volume data storage)
- **FFmpeg** (Media processing)
- **AI Recommender** (<a href="https://github.com/JanadaSroor/viora-ai" target="_blank">JanadaSroor/viora-ai</a>) - Required for media similarity and content moderation.
- **Firebase** (Optional - for cloud storage)

## Firebase Configuration

Firebase is **optional** and can be toggled via environment variables:

- **`USE_FIREBASE=true`**: Enables Firebase Storage for media uploads.
- **`USE_FIREBASE=false`**: Uses local storage only (files saved to `public/` directory).

### Environment Variables

Add these to your `.env` file:

```bash
# Toggle Firebase (true/false)
USE_FIREBASE=true

# Firebase Project Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com

# Optional: Credentials (overrides JSON file)
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Development Mode

When `NODE_ENV=development`, the server automatically uses the **Firebase Storage Emulator** (`127.0.0.1:9199`) instead of production Firebase.

## Getting Started

### 1. Prerequisites Installation
If you don't have Node.js, Docker, or FFmpeg installed, you can use the provided setup script:

```bash
chmod +x install.sh
./install.sh
# This will attempt to download and install Node, Docker, and FFmpeg via apt-get
```

### 2. Application Setup
Install project dependencies and setup the database containers:

```bash
# Install NPM dependencies
npm install

# Start Databases (Postgres, Redis, Cassandra, Qdrant)
docker compose up -d
```

### 3. Media Assets Setup
To have a full experience with sample media (images, videos, reels), you need to download the `public` directory:

```bash
# Download and extract media assets (approx 0.5GB)
npm run assets:download

# Download database snapshots and SQL dumps (approx 80MB)
npm run data:download
```

### 4. Running the Server

```bash
# Development (starts server + health check)
npm run dev

# Production
npm start

# Run CLI tools
npm run viora -- --help
```

## Testing & Debugging

### 1. Initial Data
All databases (Postgres, Cassandra, Qdrant) are automatically initialized with **sample data** (users, posts, interactions) upon the first `docker compose up -d`. This is designed to help you debug and test the application features directly without needing to manually create content.

### 2. Quick Start Account
You can login directly to the application using the following test account:
- **Email:** `johndoe.example212@gmail.com`
- **Password:** `P@ssw0rd`

### 3. Running the Admin Dashboard

Open the admin dashboard in your browser at `http://localhost:3003/admin/logs`
Change the port to current port of the server
The password is `admin123`
You can see the live logs of the server in live log screen 
The logs will work only if the server is running in development mode

```ts
//Logger
initLogger(
  {
    io: io,
    enableConsole: true,
    enableError: true,
    enableDebug: true,
    enableInfo: true,
    enableWarn: true,
    kill: process.env.NODE_ENV=="production", //kill the server if NODE_ENV is production
    //skipFiles: [],
    skipFunctions: ["checkAccountStatus"]
  }
);
```
Also you can skip some functions or files from logging

```ts
//Logger
initLogger(
  {
    io: io,
    enableConsole: true,
    enableError: true,
    enableDebug: true,
    enableInfo: true,
    enableWarn: true,
    kill: process.env.NODE_ENV=="production", //kill the server if NODE_ENV is production
    skipFiles: ["src/validators/validator.ts"],
    skipFunctions: ["checkAccountStatus"]
  }
);
```

## License

This project is open source and available under the [Apache License 2.0](LICENSE).
