import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { EventBus } from '../realtime/event.bus';
import { env } from '../config/env';
import logger from '../utils/logger';
import { getIO } from '../realtime/socket.server';

/**
 * Realtime Dev Controller — DEVELOPMENT ONLY.
 *
 * Exposes a single endpoint (POST /realtime/dev-emit) that lets a
 * developer trigger an EventBus emit via HTTP, so socket delivery can
 * be tested end-to-end without a mobile client.
 *
 * SECURITY — three-layer defence:
 *
 *   1. Production gate: env.nodeEnv === 'production' → hard 404.
 *      The route does not exist in production, at all.
 *
 *   2. Fixed event whitelist: only 'notification' is allowed. No
 *      arbitrary event names can be emitted.
 *
 *   3. Self-target only: the endpoint refuses to emit to any userId
 *      other than the authenticated caller. A malicious user cannot
 *      push events to another user's socket.
 *
 * If any of these three is removed, this controller becomes a
 * production security risk. Do not weaken them without a formal
 * security review and an ADR.
 */
export class RealtimeDevController {
  /**
   * POST /api/v1/realtime/dev-emit
   *
   * Body:
   *   {
   *     userId: string,     // must equal req.user.id
   *     event: 'notification',
   *     payload: { title, body, category?, meta? }
   *   }
   */
  async devEmit(req: AuthRequest, res: Response): Promise<Response> {
    // ============================================
    // LAYER 1 — Production gate
    // ============================================
    // The route is also gated at the router level, but defence in
    // depth: check again here.
    if (env.nodeEnv === 'production') {
      return ApiResponseHandler.notFound(res, 'Not found');
    }

    // ============================================
    // AUTHENTICATION
    // ============================================
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { userId, event, payload } = req.body as {
      userId?: string;
      event?: string;
      payload?: Record<string, unknown>;
    };

    // ============================================
    // LAYER 3 — Self-target only
    // ============================================
    if (!userId || userId !== authenticatedUserId) {
      return ApiResponseHandler.forbidden(
        res,
        'dev-emit may only target the authenticated user'
      );
    }

    // ============================================
    // LAYER 2 — Fixed event whitelist
    // ============================================
    if (event !== 'notification') {
      return ApiResponseHandler.validationError(
        res,
        "Only 'notification' events may be emitted through dev-emit"
      );
    }

    if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') {
      return ApiResponseHandler.validationError(
        res,
        'payload must include title and body strings'
      );
    }

    // ============================================
    // EMIT VIA EVENTBUS
    // ============================================
    EventBus.emitToUser(authenticatedUserId, 'notification', {
      title: payload.title as string,
      body: payload.body as string,
      category: (payload.category as string | undefined) ?? 'dev',
      meta: (payload.meta as Record<string, unknown> | undefined) ?? {},
    });

    logger.info(
      `dev-emit: notification emitted to user ${authenticatedUserId}`
    );

    return ApiResponseHandler.success(res, {
      emitted: true,
      event: 'notification',
      targetUserId: authenticatedUserId,
    });
  }

  /**
   * POST /api/v1/realtime/dev-emit-to-room
   *
   * DEV ONLY. Emits an event to an arbitrary room so room membership can
   * be tested without a real ride request. Same production gate as dev-emit.
   */
  async devEmitToRoom(req: AuthRequest, res: Response): Promise<Response> {
    if (env.nodeEnv === 'production') {
      return ApiResponseHandler.notFound(res, 'Not found');
    }
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    const { room, event, payload } = req.body as {
      room?: string;
      event?: string;
      payload?: Record<string, unknown>;
    };
    if (!room || typeof room !== 'string') {
      return ApiResponseHandler.validationError(res, 'room is required');
    }
    if (event !== 'notification') {
      return ApiResponseHandler.validationError(res, "Only 'notification' is allowed");
    }
    if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') {
      return ApiResponseHandler.validationError(res, 'payload must include title and body strings');
    }
    // Emit directly via the socket server to the named room.
    const io = getIO();
    io.to(room).emit('notification', {
      title: payload.title,
      body: payload.body,
      category: 'dev-test',
      meta: {},
    });
    logger.info(`dev-emit-to-room: notification → ${room}`);
    return ApiResponseHandler.success(res, { emitted: true, room });
  }
}

export default RealtimeDevController;