import redisService from "./RedisService.js";

const test = async () => {
  await redisService.testRedisConnection();
  await redisService.incrementLike('1', '1');
};

test();