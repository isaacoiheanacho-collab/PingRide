import { createClient, RedisClientType } from 'redis';
import { env } from './env';
import logger from '../utils/logger';

let redisClient: RedisClientType | null = null;
let isConnecting = false;

export function createRedisClient(): RedisClientType {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (isConnecting) {
    return redisClient as RedisClientType;
  }

  isConnecting = true;

  const config: any = {
    socket: {
      host: env.redisHost,
      port: env.redisPort,
    },
  };

  if (env.redisPassword) {
    config.password = env.redisPassword;
  }

  if (env.redisSsl) {
    config.socket.tls = true;
  }

  if (env.redisUrl) {
    try {
      new URL(env.redisUrl);
      config.url = env.redisUrl;
    } catch (error) {
      logger.warn('⚠️ Failed to parse REDIS_URL, using individual config values');
    }
  }

  redisClient = createClient(config);

  redisClient.on('connect', () => {
    logger.info('🔴 Redis connected');
    isConnecting = false;
  });

  redisClient.on('error', (err) => {
    logger.error('❌ Redis error:', err);
    isConnecting = false;
  });

  redisClient.on('end', () => {
    logger.warn('⚠️ Redis connection closed');
    isConnecting = false;
  });

  // ✅ CONNECT HERE
  redisClient.connect().catch((err) => {
    logger.error('❌ Redis connection failed:', err);
    isConnecting = false;
  });

  return redisClient;
}

export async function testRedisConnection(): Promise<boolean> {
  try {
    const client = createRedisClient();
    await client.set('test-key', 'PingRide Redis Test');
    const value = await client.get('test-key');
    await client.del('test-key');
    logger.info(`✅ Redis connected successfully: ${value}`);
    return true;
  } catch (error) {
    logger.error('❌ Redis connection failed:', error);
    return false;
  }
}

export function getRedisClient(): RedisClientType {
  if (!redisClient || !redisClient.isOpen) {
    return createRedisClient();
  }
  return redisClient;
}

export default {
  createRedisClient,
  testRedisConnection,
  getRedisClient,
};