import { Pool, PoolConfig } from 'pg';
import { env } from './env';
import logger from '../utils/logger';

const config: PoolConfig = {
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUsername,
  password: env.dbPassword,
  database: env.dbDatabase,
  max: env.dbPoolMax,
  idleTimeoutMillis: env.dbPoolIdleTimeout,
  connectionTimeoutMillis: env.dbPoolConnectionTimeout,
};

// If DATABASE_URL is provided, use it instead
if (env.databaseUrl) {
  try {
    const url = new URL(env.databaseUrl);
    config.host = url.hostname;
    config.port = parseInt(url.port, 10);
    config.user = url.username;
    config.password = url.password;
    config.database = url.pathname.slice(1);
    
    // Handle SSL
    const sslParam = url.searchParams.get('sslmode');
    if (sslParam === 'require' || sslParam === 'verify-full') {
      config.ssl = { rejectUnauthorized: sslParam === 'verify-full' };
    }
  } catch (error) {
    logger.warn('⚠️ Failed to parse DATABASE_URL, using individual config values');
  }
}

export const pool = new Pool(config);

// Test connection
pool.on('connect', () => {
  logger.info('📦 PostgreSQL connected');
});

pool.on('error', (err) => {
  logger.error('❌ PostgreSQL error:', err);
});

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as time');
    client.release();
    logger.info(`✅ Database connected successfully: ${result.rows[0].time}`);
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    return false;
  }
}

export default pool;