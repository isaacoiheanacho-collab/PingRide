import { Router } from 'express';
import { authenticate, requireVerified } from '../middleware/auth.middleware';
import { RealtimeDevController } from '../controllers/realtime-dev.controller';
import { env } from '../config/env';
import logger from '../utils/logger';

/**
 * [DEV-ONLY] Realtime dev routes.
 *
 * This router is mounted ONLY when NODE_ENV !== 'production'.
 * In production, it is never registered and the endpoints do not
 * exist at all.
 *
 * Endpoints:
 *   POST /dev-emit            → triggers an EventBus emit to the caller
 *   POST /dev-emit-to-room    → triggers an emit to an arbitrary room
 *   GET  /dev-driver-location → inspects cached driver location in Redis
 *
 * If you add more dev-only routes, they go here, and they inherit the
 * production gate below.
 */

const router = Router();
const controller = new RealtimeDevController();

// ============================================
// PRODUCTION GATE — hard refusal
// ============================================
// If, through some misconfiguration, this router is ever loaded in
// production, every route it exposes returns 404. The gate is not
// conditional on anything the caller can influence.
if (env.nodeEnv !== 'production') {
  router.post(
    '/dev-emit',
    authenticate,
    requireVerified(),
    controller.devEmit.bind(controller)
  );
  router.post(
    '/dev-emit-to-room',
    authenticate,
    requireVerified(),
    controller.devEmitToRoom.bind(controller)
  );
  router.get(
    '/dev-driver-location/:driverUserId',
    authenticate,
    requireVerified(),
    controller.devGetDriverLocation.bind(controller)
  );
} else {
  logger.warn(
    '[DEV-ONLY] realtime-dev.routes loaded in production — all endpoints disabled'
  );
}

export default router;