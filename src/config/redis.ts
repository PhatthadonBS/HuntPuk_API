import { createClient } from 'redis';

// Connect to the redis service defined in docker-compose.yml or via ENV (e.g. Render)
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const redisClient = createClient({
  url: redisUrl
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis successfully'));

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

export default redisClient;
