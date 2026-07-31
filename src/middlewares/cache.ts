import { Request, Response, NextFunction } from 'express';
import redisClient from '../config/redis';

/**
 * Middleware to cache API responses
 * @param durationSeconds Time in seconds to keep the cache
 */
export const cacheMiddleware = (durationSeconds: number) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Use URL as cache key
    const key = `__express__${req.originalUrl || req.url}`;

    try {
      if (!redisClient.isOpen) {
        return next();
      }

      const cachedResponse = await redisClient.get(key);

      if (cachedResponse) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cachedResponse));
      } else {
        res.setHeader('X-Cache', 'MISS');
        // Override res.json to intercept the response and cache it
        const originalJson = res.json.bind(res);
        res.json = (body: any): Response => {
          // Cache the response
          redisClient.setEx(key, durationSeconds, JSON.stringify(body))
            .catch(err => console.error('Redis cache error:', err));
          
          return originalJson(body);
        };
        next();
      }
    } catch (error) {
      console.error('Cache middleware error:', error);
      next(); // Continue to controller on error
    }
  };
};
