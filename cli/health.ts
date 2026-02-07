import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from 'redis';
import pg from 'pg';
import cassandra from 'cassandra-driver';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(projectRoot, '.env') });

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    BOLD: '\x1b[1m',
};

const log = {
    info: (msg: string) => console.log(`${COLORS.BLUE}ℹ ${msg}${COLORS.RESET}`),
    success: (msg: string) => console.log(`${COLORS.GREEN}✔ ${msg}${COLORS.RESET}`),
    warning: (msg: string) => console.log(`${COLORS.YELLOW}⚠ ${msg}${COLORS.RESET}`),
    error: (msg: string) => console.log(`${COLORS.RED}✖ ${msg}${COLORS.RESET}`),
    header: (msg: string) => console.log(`\n${COLORS.BOLD}=== ${msg} ===${COLORS.RESET}`),
};

async function checkTool(name: string, command: string): Promise<boolean> {
    try {
        const { stdout } = await execAsync(command);
        // Remove newlines for cleaner output
        const version = stdout.trim().split('\n')[0];
        log.success(`${name} is installed: ${version}`);
        return true;
    } catch (error) {
        log.warning(`${name} is NOT installed or not in PATH.`);
        return false;
    }
}

export async function runHealthCheck() {
    console.log(`${COLORS.BOLD}Starting Viora System Doctor...${COLORS.RESET}`);

    let allHealthy = true;

    // 1. Environment Variables Check
    log.header('Environment Variables');
    const criticalVars = [
        'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME',
        'REDIS_HOST', 'REDIS_PORT',
        'ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET'
    ];
    const configVars = [
        'CASSANDRA_CONTACT_POINTS', 'CASSANDRA_DC', 'CASSANDRA_KEYSPACE',
        'QDRANT_URL', 'EMBEDDING_SERVER_URL', 'LAZY_EMBEDDING_MODE'
    ];

    const missingCritical = criticalVars.filter(v => !process.env[v]);
    const missingConfig = configVars.filter(v => !process.env[v]);

    if (missingCritical.length === 0) {
        log.success('All critical environment variables are set.');
    } else {
        allHealthy = false;
        log.error(`Missing critical environment variables: ${missingCritical.join(', ')}`);
    }

    if (missingConfig.length > 0) {
        log.info(`Using defaults for configuration variables: ${missingConfig.join(', ')}`);
    }

    // 2. System Tools Check
    log.header('System Tools');
    await checkTool('Docker', 'docker --version');
    await checkTool('PostgreSQL Client (psql)', 'psql --version');
    await checkTool('Cassandra Client (cqlsh)', 'cqlsh --version');
    await checkTool('Redis Client (redis-cli)', 'redis-cli --version');
    await checkTool('FFmpeg', 'ffmpeg -version');

    // 3. Data Snapshots Check
    log.header('Data Snapshots');
    const snapshotDir = path.join(projectRoot, 'db_schema', 'qdrant_snapshots');
    if (fs.existsSync(snapshotDir)) {
        const snapshots = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.snapshot'));
        if (snapshots.length >= 4) {
            log.success(`Found ${snapshots.length} Qdrant snapshots in db_schema/qdrant_snapshots.`);
        } else {
            log.warning(`Only found ${snapshots.length} snapshots. Some vector data might be missing.`);
        }
    } else {
        log.warning('Snapshot directory not found. Auto-seeding for Qdrant may fail.');
    }

    // 4. Dependencies Check
    log.header('Dependencies');
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
        log.success('node_modules directory found.');
    } else {
        allHealthy = false;
        log.error('node_modules not found. Please run `npm install`.');
    }

    // 5. Database Connection Check
    log.header('Database Connection');
    if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
        const connectionString = `postgres://${process.env.DB_USER}:${process.env.DB_PASS || ''}@${process.env.DB_HOST}/${process.env.DB_NAME}`;

        try {
            const pool = new pg.Pool({
                connectionString,
                connectionTimeoutMillis: 5000,
            });
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            await pool.end();
            log.success('Successfully connected to PostgreSQL.');
        } catch (error: any) {
            allHealthy = false;
            log.error(`Database connection failed: ${error.message}`);
        }
    } else {
        log.warning('Skipping DB check (DB vars missing).');
    }

    // 5. Redis Connection Check
    log.header('Redis Connection');
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
        const redisUrl = `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
        try {
            const client = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: 5000,
                }
            });
            client.on('error', (err) => {
                // Suppress default error logging to console during check
            });
            await client.connect();
            await client.ping();
            await client.disconnect();
            log.success('Successfully connected to Redis.');
        } catch (error: any) {
            allHealthy = false;
            log.error(`Redis connection failed: ${error.message}`);
        }
    } else {
        log.warning('Skipping Redis check (Redis vars missing).');
    }

    // 6. Cassandra Connection Check
    log.header('Cassandra Connection');
    const cassandraPoints = process.env.CASSANDRA_CONTACT_POINTS ? process.env.CASSANDRA_CONTACT_POINTS.split(',') : ['localhost'];
    const cassandraDC = process.env.CASSANDRA_DC || 'datacenter1';
    const cassandraKeyspace = process.env.CASSANDRA_KEYSPACE || 'viora_pluse_v1';

    try {
        const client = new cassandra.Client({
            contactPoints: cassandraPoints,
            localDataCenter: cassandraDC,
            keyspace: cassandraKeyspace
        });
        await client.connect();
        await client.execute('SELECT now() FROM system.local');
        await client.shutdown();
        log.success(`Successfully connected to Cassandra (${cassandraPoints.join(',')} @ ${cassandraDC}).`);
    } catch (error: any) {
        allHealthy = false;
        log.error(`Cassandra connection failed: ${error.message}`);
    }

    // 7. Qdrant Connection Check
    log.header('Qdrant Connection');
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    try {
        const response = await fetch(`${qdrantUrl}/collections`, { timeout: 3000 } as any);
        if (response.ok) {
            const data: any = await response.json();
            const collections = data.result?.collections?.map((c: any) => c.name) || [];
            log.success(`Successfully connected to Qdrant at ${qdrantUrl}. Found ${collections.length} collections: ${collections.join(', ')}`);
        } else {
            allHealthy = false;
            log.error(`Qdrant connection failed with status: ${response.status}`);
        }
    } catch (error: any) {
        allHealthy = false;
        log.error(`Qdrant connection failed: ${error.message}`);
    }

    // 8. Server Health Check
    log.header('Server Status Check');
    const port = process.env.PORT || 3003; // Default in .env.example wasn't explicit on PORT but implied by BASE_URL
    const healthUrl = `http://localhost:${port}/health`;
    try {
        const response = await fetch(healthUrl, { timeout: 3000 } as any);
        if (response.ok) {
            log.success(`Server is running at ${healthUrl}`);
        } else {
            log.warning(`Server responded with status ${response.status} at ${healthUrl}`);
        }
    } catch (error: any) {
        log.warning(`Server is effectively offline (could not reach ${healthUrl}). This is expected if the server isn't running.`);
    }

    console.log('\n----------------------------------------');
    if (allHealthy) {
        console.log(`${COLORS.GREEN}${COLORS.BOLD}Viora system check passed!${COLORS.RESET}`);
    } else {
        console.log(`${COLORS.RED}${COLORS.BOLD}Some issues were detected. Check the logs above.${COLORS.RESET}`);
        process.exitCode = 1;
    }
}
