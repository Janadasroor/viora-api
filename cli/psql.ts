import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

// Load environment variables
dotenv.config({ path: path.join(projectRoot, ".env") });

export const pool = new Pool({
    user: process.env.DB_USER || "viora",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "viora_pluse_v1",
    password: process.env.DB_PASS || "123456",
    port: parseInt(process.env.DB_PORT || "5432"),
    // Connection timeout settings
    connectionTimeoutMillis: 10000, // 10 seconds
    query_timeout: 30000, // 30 seconds for queries
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    max: 20, // Maximum number of clients in pool
    min: 2, // Minimum number of clients in pool
});

