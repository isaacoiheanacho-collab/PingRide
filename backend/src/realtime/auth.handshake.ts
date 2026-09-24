import { Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { UserModel } from '../models/user.model';
import logger from '../utils/logger';

/**
 * Socket.io handshake authentication.
 *
 * Runs as middleware before any 'connection' handler fires.
 * Rejects the socket if:
 *   - no token is provided
 *   - token is invalid or expired
 *   - user no longer exists
 *   - user is suspended, deactivated, or locked
 *
 * On success, attaches `socket.user` with the verified identity.
 *
 * Accepted statuses mirror HTTP auth middleware:
 *   - 'active'                — normal user
 *   - 'pending_verification'  — registered, waiting for OTP
 */
const TOKEN_HOLDING_STATUSES = ['active', 'pending_verification'];

export interface SocketUser {
  id: string;
  phone: string;
  role: string;
  userType: string;
  status: string;
}

export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    // ============================================
    // STEP 1 — Extract token from handshake
    // ============================================
    // Client sends: io(url, { auth: { token: 'Bearer <jwt>' } })
    // We accept both 'Bearer <jwt>' and raw '<jwt>' for flexibility.
    const rawToken = socket.handshake.auth?.token
      || socket.handshake.headers?.authorization;

    if (!rawToken || typeof rawToken !== 'string') {
      logger.warn(`Socket auth rejected: no token (socket ${socket.id})`);
      return next(new Error('AUTH_MISSING_TOKEN'));
    }

    const token = rawToken.startsWith('Bearer ')
      ? rawToken.slice(7)
      : rawToken;

    // ============================================
    // STEP 2 — Verify JWT signature + expiry
    // ============================================
    const decoded = verifyAccessToken(token);
    if (!decoded) {
      logger.warn(`Socket auth rejected: invalid or expired token (socket ${socket.id})`);
      return next(new Error('AUTH_INVALID_TOKEN'));
    }

    // ============================================
    // STEP 3 — Load fresh user record
    // ============================================
    // We re-fetch from DB rather than trusting the token's claims —
    // a user could have been suspended since the token was issued.
    let user = null;
    let retries = 3;

    while (retries > 0 && !user) {
      try {
        user = await UserModel.findById(decoded.sub);
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!user) {
      logger.warn(`Socket auth rejected: user not found (sub=${decoded.sub})`);
      return next(new Error('AUTH_USER_NOT_FOUND'));
    }

    // ============================================
    // STEP 4 — Check account status
    // ============================================
    if (!TOKEN_HOLDING_STATUSES.includes(user.status)) {
      logger.warn(
        `Socket auth rejected: account status '${user.status}' (user ${user.id})`
      );
      return next(new Error(`AUTH_ACCOUNT_${user.status.toUpperCase()}`));
    }

    // ============================================
    // STEP 5 — Attach user to socket
    // ============================================
    (socket as any).user = {
      id: user.id,
      phone: user.phone_number,
      role: user.role,
      userType: user.role,
      status: user.status,
    } satisfies SocketUser;

    logger.info(
      `Socket auth accepted: user ${user.id} (${user.role}) — socket ${socket.id}`
    );

    return next();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Socket auth error (socket ${socket.id}): ${msg}`);

    if (msg.includes('Connection terminated') || msg.includes('timeout')) {
      return next(new Error('AUTH_DB_UNAVAILABLE'));
    }

    return next(new Error('AUTH_FAILED'));
  }
}