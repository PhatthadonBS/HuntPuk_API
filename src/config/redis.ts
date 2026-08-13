import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || '';
const redisClient = createClient({
  url: redisUrl
});

redisClient.on('error', (err) => console.log('Redis Client Error:', err.message));
redisClient.on('connect', () => console.log('Connected to Redis successfully'));

export const connectRedis = async () => {
  if (!process.env.REDIS_URL) {
    console.log('No REDIS_URL provided, skipping Redis connection.');
    return;
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

export default redisClient;
