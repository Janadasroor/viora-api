export function redisConnection() {
    const config = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
        maxRetriesPerRequest: null
    };
    return config;
}