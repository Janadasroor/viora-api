// redisClient.ts
import { createClient } from 'redis';
import { sInfo, sError } from 'sk-logger';

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) return new Error('Max retries reached');
            return Math.min(retries * 50, 500);
        }
    }
});

redisClient.on('error', (err) => sError(' Redis Error:', err));
redisClient.on('connect', () => sInfo(' Redis Connecting...'));
redisClient.on('ready', () => sInfo(' Redis Ready'));
redisClient.on('end', () => sInfo(' Redis Disconnected'));

// Export the connection promise
export const redisReady = redisClient.connect().catch((err) => {
    sError(' Redis Connection Failed:', err);
    throw err;
});

export default redisClient;