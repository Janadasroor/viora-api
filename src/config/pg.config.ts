import "dotenv/config";
import { Pool, types } from "pg";

// Force PostgreSQL 'timestamp without time zone' (OID 1114) to be parsed as UTC.
// By default, the pg driver parses this as local time.
types.setTypeParser(1114, (val) => {
    return val ? new Date(val + "Z") : null;
});

export const pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: "localhost",
    database: "viora_pluse_v1",
    password: process.env.DB_PASS || "postgres",
    port: 5432,
    // Connection timeout settings
    connectionTimeoutMillis: 10000, // 10 seconds
    query_timeout: 30000, // 30 seconds for queries
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    max: 50, // Maximum number of clients in pool (increased for seeding operations)
    min: 5, // Minimum number of clients in pool

});

export const queryResult = async (query: string) => {
    const client = await pool.connect();
    try {
        const result = await client.query(query);
        return result.rows;
    } catch (error) {
        throw error;
    } finally {
        client.release();
    }
};
