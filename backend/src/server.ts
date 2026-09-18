import app from './app';
import { env } from './config/env';
import logger from './utils/logger';
import { testDatabaseConnection } from './config/database';
import { testRedisConnection } from './config/redis';
import { verifyDatabase } from './startup/verify-db';

const PORT = env.port;

async function startServer() {
  logger.info(`🚀 Starting PingRide Backend v1.0.0`);
  logger.info(`📋 Environment: ${env.nodeEnv}`);
  logger.info(`📋 Port: ${PORT}`);

  // ============================================
  // STEP 1: Verify database schema
  // ============================================
  // Before we even test the connection, confirm the database has the
  // tables and columns the application expects. This catches missing
  // migrations at boot instead of at first request.
  //
  // In production, a missing table/column kills the process — better
  // than serving traffic that throws "column does not exist" on a
  // rarely-hit endpoint. In development, we still exit, because you
  // want to know about it immediately when you start the server.
  await verifyDatabase();

  // ============================================
  // STEP 2: Test database connection
  // ============================================
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    logger.error('❌ Database connection failed. Exiting...');
    process.exit(1);
  }

  // ============================================
  // STEP 3: Test Redis connection
  // ============================================
  const redisConnected = await testRedisConnection();
  if (!redisConnected) {
    logger.warn('⚠️ Redis connection failed. Continuing without cache...');
  }

  // ============================================
  // STEP 4: Start HTTP server
  // ============================================
  const server = app.listen(PORT, () => {
    logger.info(`✅ Server running on http://localhost:${PORT}`);
    logger.info(`📍 Health check: http://localhost:${PORT}/health`);
    logger.info(`📍 Ready check: http://localhost:${PORT}/health/ready`);
    logger.info(`📅 Started at: ${new Date().toISOString()}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('🛑 Shutting down gracefully...');
    server.close(() => {
      logger.info('✅ Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((error) => {
  logger.error('❌ Failed to start server:', error);
  process.exit(1);
});