import { Request, Response } from 'express';
import { ApiResponseHandler } from '../utils/response';
import { env } from '../config/env';
import pool from '../config/database';
import { getRedisClient } from '../config/redis';
import logger from '../utils/logger';

export class HealthController {
  async health(_req: Request, res: Response): Promise<Response> {
    return ApiResponseHandler.success(res, {
      status: 'healthy',
      service: 'pingride-backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: env.nodeEnv,
    });
  }

  async ready(_req: Request, res: Response): Promise<Response> {
    try {
      // Check database
      const dbClient = await pool.connect();
      await dbClient.query('SELECT 1');
      dbClient.release();

      // Check Redis
      const redis = getRedisClient();
      await redis.ping();

      return ApiResponseHandler.success(res, {
        status: 'ready',
        services: {
          database: 'healthy',
          redis: 'healthy',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Ready check failed:', error);
      return ApiResponseHandler.serverError(res, 'Service not ready');
    }
  }
}